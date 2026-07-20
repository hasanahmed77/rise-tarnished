import { defineConfig } from 'vitest/config';

// Separate from vitest.config.ts on purpose: this suite needs a running
// local Supabase stack (real Postgres + RLS), unlike the hermetic unit
// suite. Never point this at the live project — see supabase/tests/rls.test.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['supabase/tests/**/*.test.ts'],
    testTimeout: 15000, // real network round-trips to local Postgres/GoTrue
  },
});
