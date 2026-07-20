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

describe('RLS: cross-user isolation (#5 DoD)', () => {
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    const suffix = Date.now();
    userA = await createSignedInUser(`rls-test-a-${suffix}@example.com`);
    userB = await createSignedInUser(`rls-test-b-${suffix}@example.com`);
  });

  afterAll(async () => {
    await admin.auth.admin.deleteUser(userA.id);
    await admin.auth.admin.deleteUser(userB.id);
  });

  it("a user CAN read and update their own player_stats (positive case — RLS isn't deny-all)", async () => {
    const { data: own, error: readError } = await userA.client
      .from('player_stats')
      .select('*')
      .eq('user_id', userA.id)
      .single();
    expect(readError).toBeNull();
    expect(own?.user_id).toBe(userA.id);
    expect(own?.vitality).toBe(10); // matches the sandbox's starting build

    const { error: updateError } = await userA.client
      .from('player_stats')
      .update({ runes: 500 })
      .eq('user_id', userA.id);
    expect(updateError).toBeNull();
  });

  it("player_stats: a user CANNOT read another user's row", async () => {
    const { data, error } = await userB.client
      .from('player_stats')
      .select('*')
      .eq('user_id', userA.id);
    expect(error).toBeNull(); // RLS filters silently, doesn't error
    expect(data).toEqual([]);
  });

  it("player_stats: a user CANNOT update another user's row", async () => {
    const { data, error } = await userB.client
      .from('player_stats')
      .update({ runes: 999999 })
      .eq('user_id', userA.id)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]); // matched zero rows — the RLS-filtered set was empty

    const { data: stillOwners } = await admin
      .from('player_stats')
      .select('runes')
      .eq('user_id', userA.id)
      .single();
    expect(stillOwners?.runes).toBe(500); // unchanged by B's attempt
  });

  it("player_progress: a user CANNOT read another user's row", async () => {
    const { data, error } = await userB.client
      .from('player_progress')
      .select('*')
      .eq('user_id', userA.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
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
    const { data: aBuild, error: insertError } = await userA.client
      .from('player_builds')
      .insert({ user_id: userA.id, weapon_id: 'starting_sword' })
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

  it('new users are auto-provisioned exactly one player_stats and player_progress row (signup trigger)', async () => {
    const { data: stats } = await admin
      .from('player_stats')
      .select('user_id')
      .eq('user_id', userB.id);
    const { data: progress } = await admin
      .from('player_progress')
      .select('user_id')
      .eq('user_id', userB.id);
    expect(stats).toHaveLength(1);
    expect(progress).toHaveLength(1);
  });
});
