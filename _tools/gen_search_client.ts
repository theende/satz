// Copyright 2026 the Ende authors. MIT license.
// Writes `_search_client.ts`: `search.ts` as JavaScript in a string, which the
// build writes to `/_satz/search.js`. Importing it keeps the client in satz's
// module graph, so builds don't fetch or transpile it. Run `ende task gen`
// after changing `search.ts`; a test fails while the two disagree.
import { join } from "@ende/path";

const ROOT = join(import.meta.dirname!, "..");

/** The source of `_search_client.ts` for the current `search.ts`. */
export async function searchClientModule(): Promise<string> {
  const outdir = await Ende.makeTempDir({ prefix: "satz-gen-" });

  try {
    const { code, stderr } = await new Ende.Command(Ende.execPath(), {
      args: ["transpile", "--no-config", "--outdir", outdir, "search.ts"],
      cwd: ROOT,
      env: { NO_COLOR: "1" },
      stdout: "null",
      stderr: "piped"
    })
      .output();

    if (code !== 0)
      throw new Error(`Could not transpile search.ts: ${new TextDecoder().decode(stderr)}`);

    const js = await Ende.readTextFile(join(outdir, "search.js"));

    return `// Copyright 2026 the Ende authors. MIT license.
// Generated from search.ts by \`ende task gen\`. Do not edit.

/** \`@ende/satz/search\` as JavaScript, for \`/_satz/search.js\`. */
export const SEARCH_CLIENT =
  ${JSON.stringify(js)};
`;
  } finally {
    await Ende.remove(outdir, { recursive: true });
  }
}

if (import.meta.main)
  await Ende.writeTextFile(join(ROOT, "_search_client.ts"), await searchClientModule());
