// ADR-0004's server-only key guarantee, asserted rather than trusted.
//
// This scans actual source files rather than a built bundle because Next.js's
// client/server boundary is enforced by *which module a client component can
// import*, not by a runtime check — the real risk is a future edit adding
// `OPENAI_API_KEY` to a 'use client' file or a module such a file imports.
// Catching that at the source-file level is earlier and cheaper than waiting
// for a build-output grep, and it doesn't require an actual `next build` to
// run as part of `npm test` (the fast, hermetic suite).
//
// Excludes *.test.ts(x) from the scan: this file's own string literal below
// would otherwise be a false positive against itself.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('OPENAI_API_KEY stays server-only (ADR-0004)', () => {
  const srcDir = path.resolve(process.cwd(), 'src');
  const files = collectSourceFiles(srcDir);

  it('is referenced from exactly one file: the recap handler', () => {
    const hits = files.filter((f) => readFileSync(f, 'utf8').includes('OPENAI_API_KEY'));
    expect(hits).toEqual([path.join(srcDir, 'app', 'api', 'recap', 'handler.ts')]);
  });

  it('that one file is not a client component', () => {
    // route.ts/handler.ts have no 'use client' directive and Next.js Route
    // Handlers only ever execute server-side, so this is a second, cheap
    // confirmation on top of the file-identity check above.
    const handler = readFileSync(path.join(srcDir, 'app', 'api', 'recap', 'handler.ts'), 'utf8');
    expect(handler).not.toContain("'use client'");
  });

  it('never appears with a NEXT_PUBLIC_ prefix anywhere in src', () => {
    // The one convention that actually determines whether Next.js inlines a
    // var into the client bundle (see .env.example) — worth a direct check,
    // not just an inference from "it's not in a client file today".
    for (const f of files) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/NEXT_PUBLIC_OPENAI/);
    }
  });
});
