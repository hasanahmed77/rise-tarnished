// #13 / ADR-0004 — the recap route's orchestration, contract-tested.
//
// Every test here injects `supabase` and `callProvider` (handler.ts's two
// impure boundaries) rather than hitting real Postgres or a real network
// call — the DoD requires provider calls to be mocked in CI and never hit
// the live API, and this is where that's actually enforced: `callOpenAI`'s
// own tests below mock `fetch`, and these tests never construct a real
// `callOpenAI` at all.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { callOpenAI, handleRecapRequest, RECAP_MODEL, type SupabaseLike } from './handler';
import type { RecapPrompt } from '@/game/attempt/recap';
import type { DecisionEvent } from '@/game/boss/decisionLog';

function fakeSupabase(
  row: { boss_id: string; result: string; duration_ticks: number; log: unknown } | null,
): SupabaseLike {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: row, error: row ? null : { message: 'not found' } }),
        }),
      }),
    }),
  };
}

const killer: DecisionEvent = {
  tick: 500,
  layer: 'action',
  chose: 'margit.delayed_overhead',
  becauseSignals: [{ signal: 'dodgeReflex', value: 0.82, effect: 3.46 }],
  playerStateSnapshot: { hp: 0, stamina: 10, distance: 40, action: null },
};

describe('handleRecapRequest', () => {
  it('returns the model text when it is grounded in the real log', async () => {
    const supabase = fakeSupabase({
      boss_id: 'margit',
      result: 'death',
      duration_ticks: 900,
      log: { decisions: [killer] },
    });
    const callProvider = vi.fn(async () => 'Margit read your panic-rolls and baited the overhead.');

    const result = await handleRecapRequest({ attemptId: 'a1', supabase, callProvider });

    expect(result).toEqual({ recap: 'Margit read your panic-rolls and baited the overhead.' });
    expect(callProvider).toHaveBeenCalledTimes(1);
  });

  it('never calls the provider when there is no row — not found, or RLS says not this user', async () => {
    const callProvider = vi.fn();
    const result = await handleRecapRequest({
      attemptId: 'missing',
      supabase: fakeSupabase(null),
      callProvider,
    });
    expect(result).toEqual({ recap: null });
    expect(callProvider).not.toHaveBeenCalled();
  });

  it('never calls the provider for a victory — nothing to explain', async () => {
    const callProvider = vi.fn();
    const result = await handleRecapRequest({
      attemptId: 'a2',
      supabase: fakeSupabase({
        boss_id: 'margit',
        result: 'victory',
        duration_ticks: 900,
        log: { decisions: [killer] },
      }),
      callProvider,
    });
    expect(result).toEqual({ recap: null });
    expect(callProvider).not.toHaveBeenCalled();
  });

  it('never calls the provider for a death with no recorded decision', async () => {
    const callProvider = vi.fn();
    const result = await handleRecapRequest({
      attemptId: 'a3',
      supabase: fakeSupabase({ boss_id: 'margit', result: 'death', duration_ticks: 10, log: {} }),
      callProvider,
    });
    expect(result).toEqual({ recap: null });
    expect(callProvider).not.toHaveBeenCalled();
  });

  it('degrades to no recap when the provider throws — never propagates the error', async () => {
    const result = await handleRecapRequest({
      attemptId: 'a4',
      supabase: fakeSupabase({
        boss_id: 'margit',
        result: 'death',
        duration_ticks: 900,
        log: { decisions: [killer] },
      }),
      callProvider: vi.fn(async () => {
        throw new Error('OpenAI responded 500');
      }),
    });
    expect(result).toEqual({ recap: null });
  });

  it('discards a response that names a move this attempt never chose (ADR-0004 grounding)', async () => {
    const result = await handleRecapRequest({
      attemptId: 'a5',
      supabase: fakeSupabase({
        boss_id: 'margit',
        result: 'death',
        duration_ticks: 900,
        log: { decisions: [killer] },
      }),
      callProvider: vi.fn(async () => 'You were grabbed with margit.grab.'),
    });
    expect(result).toEqual({ recap: null });
  });

  it('tolerates a malformed log column instead of crashing', async () => {
    const callProvider = vi.fn();
    const result = await handleRecapRequest({
      attemptId: 'a6',
      supabase: fakeSupabase({
        boss_id: 'margit',
        result: 'death',
        duration_ticks: 900,
        log: 'not-an-object',
      }),
      callProvider,
    });
    expect(result).toEqual({ recap: null });
    expect(callProvider).not.toHaveBeenCalled();
  });
});

describe('callOpenAI (the real provider, network mocked)', () => {
  const prompt: RecapPrompt = { system: 'sys', user: 'usr' };
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('throws when OPENAI_API_KEY is unset, and never calls fetch at all', async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(callOpenAI(prompt)).rejects.toThrow(/OPENAI_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the configured model and both prompt roles, and extracts the reply text', async () => {
    process.env.OPENAI_API_KEY = 'test-key-not-real';
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { model: string; messages: unknown };
      expect(body.model).toBe(RECAP_MODEL);
      expect(body.messages).toEqual([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' },
      ]);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '  Margit read your panic-rolls.  ' } }],
        }),
        { status: 200 },
      );
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(callOpenAI(prompt)).resolves.toBe('Margit read your panic-rolls.');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws on a non-2xx response rather than silently returning empty text', async () => {
    process.env.OPENAI_API_KEY = 'test-key-not-real';
    global.fetch = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;

    await expect(callOpenAI(prompt)).rejects.toThrow(/500/);
  });

  it('throws rather than returning an empty string when the response has no message content', async () => {
    process.env.OPENAI_API_KEY = 'test-key-not-real';
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(callOpenAI(prompt)).rejects.toThrow(/no message content/);
  });
});
