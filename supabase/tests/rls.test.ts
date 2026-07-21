// RLS proof (#5 DoD): "a user cannot read/write another user's rows" is
// asserted against a REAL local Postgres running the checked-in migrations —
// not mocked, not assumed. This is deliberately separate from `npm test`
// (which stays fast and hermetic, no external deps): it needs a running
// local Supabase stack (`supabase start`), never the live project (SDLC §8).
//
// Run: supabase start && npm run test:rls
// CI:  a dedicated job spins up local Supabase via Docker (see ci.yml) and
// runs this exact suite — never against the live hosted project.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// A function (not bare module consts) so TS narrows the *return type*, which
// then flows correctly into closures below — a bare `if (!x) throw` at module
// scope doesn't narrow `x`'s type inside functions declared afterward.
function requireEnv() {
  const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!serviceRoleKey || !anonKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY — run `supabase start`, then ' +
        '`supabase status -o env` to get local values (see README "Local Supabase" section).',
    );
  }
  return { url, serviceRoleKey, anonKey };
}

const { url, serviceRoleKey, anonKey } = requireEnv();

const admin = createClient(url, serviceRoleKey);

interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

async function createSignedInUser(email: string): Promise<TestUser> {
  const password = 'test-password-not-real-1234';
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error('createUser returned no user');

  const client = createClient(url, anonKey);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { id: data.user.id, email, client };
}

// No generated Supabase Database types exist yet in this project, so
// `.rpc()` returns `unknown` for `data` — one typed wrapper here rather than
// casting at every call site below.
interface ResolveAttemptRow {
  rune_delta: number;
  total_runes: number;
  region_unlocked: boolean;
}

function callResolveAttempt(
  client: SupabaseClient,
  args: { p_attempt_id: string; p_boss_id: string; p_result: string; p_duration_ticks: number },
) {
  return client.rpc('resolve_attempt', args).single() as unknown as Promise<{
    data: ResolveAttemptRow | null;
    error: { code?: string; message: string } | null;
  }>;
}

describe('RLS: cross-user isolation (#5 DoD)', () => {
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    const suffix = Date.now();
    // Independent users — create in parallel to halve setup round-trips.
    [userA, userB] = await Promise.all([
      createSignedInUser(`rls-test-a-${suffix}@example.com`),
      createSignedInUser(`rls-test-b-${suffix}@example.com`),
    ]);
  });

  afterAll(async () => {
    await admin.auth.admin.deleteUser(userA.id);
    await admin.auth.admin.deleteUser(userB.id);
  });

  it("a user CAN read their own player_stats (positive case — RLS isn't deny-all)", async () => {
    const { data: own, error: readError } = await userA.client
      .from('player_stats')
      .select('*')
      .eq('user_id', userA.id)
      .single();
    expect(readError).toBeNull();
    expect(own?.user_id).toBe(userA.id);
    expect(own?.vitality).toBe(10); // matches the sandbox's starting build
  });

  it("player_stats is READ-ONLY to the client: even a user's own-row UPDATE is rejected", async () => {
    // Authoritative state (runes/stats) is never client-writable — there is no
    // UPDATE grant for `authenticated`, so this fails at the table-ACL layer
    // before RLS is even consulted. This is the fix for the "a player can PATCH
    // their own runes to a billion via the raw REST API" hole: mutations only
    // ever happen through the server-validated write path (#11/#12).
    const { error } = await userA.client
      .from('player_stats')
      .update({ runes: 999999 })
      .eq('user_id', userA.id);
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501'); // permission denied for table

    const { data: unchanged } = await admin
      .from('player_stats')
      .select('runes')
      .eq('user_id', userA.id)
      .single();
    expect(Number(unchanged?.runes)).toBe(0); // still the provisioned default
  });

  it("player_stats: a user CANNOT read another user's row", async () => {
    const { data, error } = await userB.client
      .from('player_stats')
      .select('*')
      .eq('user_id', userA.id);
    expect(error).toBeNull(); // RLS filters silently, doesn't error
    expect(data).toEqual([]);
  });

  it("player_progress: a user CANNOT read another user's row", async () => {
    const { data, error } = await userB.client
      .from('player_progress')
      .select('*')
      .eq('user_id', userA.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("player_progress is READ-ONLY to the client: even a user's own-row UPDATE is rejected", async () => {
    // Same posture as player_stats — clearing a region is a server-validated
    // event, not a client write. No UPDATE grant, so this is denied at the ACL.
    const { error } = await userA.client
      .from('player_progress')
      .update({ current_region: 'elden_throne' })
      .eq('user_id', userA.id);
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');

    const { data: unchanged } = await admin
      .from('player_progress')
      .select('current_region')
      .eq('user_id', userA.id)
      .single();
    expect(unchanged?.current_region).toBe('stormveil'); // still the default
  });

  it("attempt_logs: a user CANNOT insert a row impersonating another user's user_id", async () => {
    const { error } = await userB.client.from('attempt_logs').insert({
      user_id: userA.id, // impersonation attempt
      boss_id: 'margit',
      result: 'death',
      duration_ticks: 100,
    });
    expect(error).not.toBeNull(); // the WITH CHECK clause rejects it
  });

  it('attempt_logs: a user CAN insert their own row, and only sees their own rows', async () => {
    const { error: insertError } = await userA.client.from('attempt_logs').insert({
      user_id: userA.id,
      boss_id: 'margit',
      result: 'death',
      duration_ticks: 4200,
    });
    expect(insertError).toBeNull();

    const { data: aSees } = await userA.client.from('attempt_logs').select('*');
    expect(aSees?.length).toBeGreaterThanOrEqual(1);

    const { data: bSees } = await userB.client
      .from('attempt_logs')
      .select('*')
      .eq('user_id', userA.id);
    expect(bSees).toEqual([]);
  });

  it("player_builds: a user CANNOT insert, read, or delete another user's build", async () => {
    // is_active:false — A already has an auto-provisioned active build, and the
    // one-active-build-per-user unique index would reject a second active one.
    const { data: aBuild, error: insertError } = await userA.client
      .from('player_builds')
      .insert({ user_id: userA.id, weapon_id: 'greatsword', is_active: false })
      .select()
      .single();
    expect(insertError).toBeNull();

    const { data: bReads } = await userB.client
      .from('player_builds')
      .select('*')
      .eq('user_id', userA.id);
    expect(bReads).toEqual([]);

    const { error: bDeleteError, count } = await userB.client
      .from('player_builds')
      .delete({ count: 'exact' })
      .eq('id', aBuild!.id);
    expect(bDeleteError).toBeNull();
    expect(count).toBe(0); // RLS-filtered to nothing, so nothing was deleted

    const { data: stillExists } = await admin
      .from('player_builds')
      .select('id')
      .eq('id', aBuild!.id)
      .single();
    expect(stillExists?.id).toBe(aBuild!.id); // survived B's delete attempt
  });

  it('new users are auto-provisioned one player_stats, player_progress, and active player_builds row (signup trigger)', async () => {
    const [{ data: stats }, { data: progress }, { data: builds }] = await Promise.all([
      admin.from('player_stats').select('user_id').eq('user_id', userB.id),
      admin.from('player_progress').select('user_id').eq('user_id', userB.id),
      admin.from('player_builds').select('id, is_active').eq('user_id', userB.id),
    ]);
    expect(stats).toHaveLength(1);
    expect(progress).toHaveLength(1);
    expect(builds).toHaveLength(1);
    expect(builds?.[0].is_active).toBe(true); // a starting loadout, ready to read
  });

  it('player_builds: at most one active build per user (unique partial index)', async () => {
    // userB has exactly its auto-provisioned active build; a second active one
    // must be rejected by player_builds_one_active_per_user.
    const { error } = await userB.client
      .from('player_builds')
      .insert({ user_id: userB.id, weapon_id: 'greatsword', is_active: true });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23505'); // unique_violation
  });
});

// resolve_attempt (#11 DoD): the only path from a finished fight to
// persisted runes/progress. Proven against real Postgres, same discipline as
// the RLS suite above — this is a SECURITY DEFINER function, so RLS doesn't
// gate it; the function's own logic is the entire boundary.
describe('resolve_attempt RPC (#11 DoD)', () => {
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    const suffix = Date.now();
    [userA, userB] = await Promise.all([
      createSignedInUser(`resolve-attempt-a-${suffix}@example.com`),
      createSignedInUser(`resolve-attempt-b-${suffix}@example.com`),
    ]);
  });

  afterAll(async () => {
    await admin.auth.admin.deleteUser(userA.id);
    await admin.auth.admin.deleteUser(userB.id);
  });

  it('an unauthenticated caller cannot call it at all', async () => {
    const anon = createClient(url, anonKey);
    const { error } = await anon.rpc('resolve_attempt', {
      p_attempt_id: crypto.randomUUID(),
      p_boss_id: 'margit',
      p_result: 'victory',
      p_duration_ticks: 100,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501'); // permission denied for function
  });

  it('victory: pays the reward from the bosses table, advances progress, and is not client-suppliable', async () => {
    // No parameter exists for the client to name an amount — p_result/p_boss_id
    // select *which* rule applies; resolve_attempt looks up the amount itself.
    const { data, error } = await callResolveAttempt(userA.client, {
      p_attempt_id: crypto.randomUUID(),
      p_boss_id: 'margit',
      p_result: 'victory',
      p_duration_ticks: 4200,
    });
    expect(error).toBeNull();
    expect(data?.rune_delta).toBe(500);
    expect(data?.total_runes).toBe(500);
    expect(data?.region_unlocked).toBe(true);

    const { data: progress } = await admin
      .from('player_progress')
      .select('current_region, regions_cleared')
      .eq('user_id', userA.id)
      .single();
    expect(progress?.current_region).toBe('redmane');
    expect(progress?.regions_cleared).toEqual(['stormveil']);
  });

  it('death: pays nothing and does not touch region progress', async () => {
    const { data, error } = await callResolveAttempt(userB.client, {
      p_attempt_id: crypto.randomUUID(),
      p_boss_id: 'margit',
      p_result: 'death',
      p_duration_ticks: 900,
    });
    expect(error).toBeNull();
    expect(data?.rune_delta).toBe(0);
    expect(data?.total_runes).toBe(0);
    expect(data?.region_unlocked).toBe(false);

    const { data: progress } = await admin
      .from('player_progress')
      .select('current_region, regions_cleared')
      .eq('user_id', userB.id)
      .single();
    expect(progress?.current_region).toBe('stormveil'); // unchanged
    expect(progress?.regions_cleared).toEqual([]);
  });

  it('is idempotent: retrying the same attempt id returns the persisted result without paying twice', async () => {
    const attemptId = crypto.randomUUID();
    const call = () =>
      callResolveAttempt(userB.client, {
        p_attempt_id: attemptId,
        p_boss_id: 'margit',
        p_result: 'victory',
        p_duration_ticks: 100,
      });

    const first = await call();
    expect(first.error).toBeNull();
    expect(first.data?.rune_delta).toBe(500);

    const second = await call();
    expect(second.error).toBeNull();
    expect(second.data?.rune_delta).toBe(500);
    expect(second.data?.total_runes).toBe(first.data?.total_runes); // not paid again

    const { data: stats } = await admin
      .from('player_stats')
      .select('runes')
      .eq('user_id', userB.id)
      .single();
    expect(Number(stats?.runes)).toBe(first.data?.total_runes); // one payout, not two
  });

  it("rejects reusing another user's attempt id rather than leaking their result", async () => {
    // userA resolves an attempt (from the earlier victory test, userA already
    // has one) — a fresh one here, distinctly owned.
    const attemptId = crypto.randomUUID();
    const { error: firstError } = await userA.client
      .rpc('resolve_attempt', {
        p_attempt_id: attemptId,
        p_boss_id: 'margit',
        p_result: 'death',
        p_duration_ticks: 50,
      })
      .single();
    expect(firstError).toBeNull();

    // userB reuses the SAME attempt id. This must not return userA's
    // rune_delta/total_runes (a cross-user leak through the RPC's own return
    // value, since SECURITY DEFINER bypasses RLS) — it must fail outright.
    const { error: reuseError } = await userB.client
      .rpc('resolve_attempt', {
        p_attempt_id: attemptId,
        p_boss_id: 'margit',
        p_result: 'victory',
        p_duration_ticks: 50,
      })
      .single();
    expect(reuseError).not.toBeNull();
  });

  it('rejects an unknown boss_id', async () => {
    const { error } = await userA.client
      .rpc('resolve_attempt', {
        p_attempt_id: crypto.randomUUID(),
        p_boss_id: 'not-a-real-boss',
        p_result: 'victory',
        p_duration_ticks: 100,
      })
      .single();
    expect(error).not.toBeNull();
  });
});
