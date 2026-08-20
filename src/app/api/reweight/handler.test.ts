// #64 / ADR-0004 — the reweight route's orchestration, contract-tested.
//
// Every test here injects `supabase` and `callProvider` (handler.ts's two
// impure boundaries) rather than hitting real Postgres or a real network
// call — same "never let a provider call escape into CI" discipline as
// recap's handler.test.ts.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { callOpenAI, handleReweightRequest, REWEIGHT_MODEL, type SupabaseLike } from './handler';
import type { ReweightPrompt } from '@/game/attempt/reweight';
import type { DecisionEvent } from '@/game/boss/decisionLog';

interface FakeTables {
  attempt_logs: { boss_id: string; log: unknown } | null;
  boss_weight_overrides: { tactic_base_score: unknown; weight_rule_gains: unknown } | null;
}

function fakeSupabase(
  tables: FakeTables,
  rpc: SupabaseLike['rpc'] = vi.fn(async () => ({ data: null, error: null })),
): SupabaseLike {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            const row = tables.attempt_logs;
            return { data: row, error: row ? null : { message: 'not found' } };
          },
          maybeSingle: async () => {
            const row = table === 'boss_weight_overrides' ? tables.boss_weight_overrides : null;
            return { data: row, error: null };
          },
        }),
      }),
    }),
    rpc,
  };
}

const killer: DecisionEvent = {
  tick: 500,
  layer: 'action',
  chose: 'margit.delayed_overhead',
  becauseSignals: [{ signal: 'dodgeReflex', value: 0.82, effect: 3.46 }],
  playerStateSnapshot: { hp: 0, stamina: 10, distance: 40, action: null },
};

const validProposal = JSON.stringify({
  tacticBaseScoreAdjustments: { BAIT: 0.9 },
  weightRuleAdjustments: { delayed: 3.5 },
});

describe('handleReweightRequest', () => {
  it('persists the validated proposal via the RPC when the attempt has a real log', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const supabase = fakeSupabase(
      {
        attempt_logs: { boss_id: 'margit', log: { decisions: [killer] } },
        boss_weight_overrides: null,
      },
      rpc,
    );
    const callProvider = vi.fn(async () => validProposal);

    const result = await handleReweightRequest({ attemptId: 'a1', supabase, callProvider });

    expect(result).toEqual({ updated: true });
    expect(rpc).toHaveBeenCalledWith('upsert_boss_weight_overrides', {
      p_boss_id: 'margit',
      p_tactic_base_score: { BAIT: 0.9 },
      p_weight_rule_gains: { delayed: 3.5 },
    });
  });

  it("merges onto the player's existing overrides rather than replacing them wholesale", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const supabase = fakeSupabase(
      {
        attempt_logs: { boss_id: 'margit', log: { decisions: [killer] } },
        boss_weight_overrides: {
          tactic_base_score: { NEUTRAL: 1.2 },
          weight_rule_gains: { grab: 4 },
        },
      },
      rpc,
    );
    const callProvider = vi.fn(async () => validProposal);

    await handleReweightRequest({ attemptId: 'a1', supabase, callProvider });

    expect(rpc).toHaveBeenCalledWith('upsert_boss_weight_overrides', {
      p_boss_id: 'margit',
      p_tactic_base_score: { NEUTRAL: 1.2, BAIT: 0.9 },
      p_weight_rule_gains: { grab: 4, delayed: 3.5 },
    });
  });

  it('never calls the provider or the RPC when there is no attempt row', async () => {
    const rpc = vi.fn();
    const callProvider = vi.fn();
    const result = await handleReweightRequest({
      attemptId: 'missing',
      supabase: fakeSupabase({ attempt_logs: null, boss_weight_overrides: null }, rpc),
      callProvider,
    });
    expect(result).toEqual({ updated: false });
    expect(callProvider).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('never calls the provider or the RPC for an attempt with no logged decisions', async () => {
    const rpc = vi.fn();
    const callProvider = vi.fn();
    const result = await handleReweightRequest({
      attemptId: 'a2',
      supabase: fakeSupabase(
        { attempt_logs: { boss_id: 'margit', log: {} }, boss_weight_overrides: null },
        rpc,
      ),
      callProvider,
    });
    expect(result).toEqual({ updated: false });
    expect(callProvider).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('degrades to no update when the provider throws — never propagates, never writes', async () => {
    const rpc = vi.fn();
    const result = await handleReweightRequest({
      attemptId: 'a3',
      supabase: fakeSupabase(
        {
          attempt_logs: { boss_id: 'margit', log: { decisions: [killer] } },
          boss_weight_overrides: null,
        },
        rpc,
      ),
      callProvider: vi.fn(async () => {
        throw new Error('OpenAI responded 500');
      }),
    });
    expect(result).toEqual({ updated: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('skips the write when every proposed name/value was rejected by validation', async () => {
    const rpc = vi.fn();
    const result = await handleReweightRequest({
      attemptId: 'a4',
      supabase: fakeSupabase(
        {
          attempt_logs: { boss_id: 'margit', log: { decisions: [killer] } },
          boss_weight_overrides: null,
        },
        rpc,
      ),
      callProvider: vi.fn(async () =>
        JSON.stringify({ tacticBaseScoreAdjustments: { PUNISH: 5 } }),
      ),
    });
    expect(result).toEqual({ updated: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports no update when the RPC itself errors, without throwing', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'db down' } }));
    const result = await handleReweightRequest({
      attemptId: 'a5',
      supabase: fakeSupabase(
        {
          attempt_logs: { boss_id: 'margit', log: { decisions: [killer] } },
          boss_weight_overrides: null,
        },
        rpc,
      ),
      callProvider: vi.fn(async () => validProposal),
    });
    expect(result).toEqual({ updated: false });
  });

  it('tolerates a malformed log column instead of crashing', async () => {
    const rpc = vi.fn();
    const callProvider = vi.fn();
    const result = await handleReweightRequest({
      attemptId: 'a6',
      supabase: fakeSupabase(
        { attempt_logs: { boss_id: 'margit', log: 'not-an-object' }, boss_weight_overrides: null },
        rpc,
      ),
      callProvider,
    });
    expect(result).toEqual({ updated: false });
    expect(callProvider).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('callOpenAI (the real provider, network mocked)', () => {
  const prompt: ReweightPrompt = { system: 'sys', user: 'usr' };
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
      expect(body.model).toBe(REWEIGHT_MODEL);
      expect(body.messages).toEqual([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' },
      ]);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"weightRuleAdjustments":{}}' } }] }),
        { status: 200 },
      );
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(callOpenAI(prompt)).resolves.toBe('{"weightRuleAdjustments":{}}');
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
