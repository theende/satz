// Copyright 2026 the Ende authors. MIT license.
/**
 * The satz command line.
 *
 * ```sh
 * ende run -A jsr:@ende/satz/cli build [--src <dir>] [--dest <dir>]
 * ```
 *
 * An optional `<src>/_config.ts` can default-export `{ dest, data }`; `dest`
 * in it is relative to `src`, and the flags win over it.
 *
 * @module
 */
import { parseArgs } from "@ende/cli/parse-args";
import { join, resolve, toFileUrl } from "@ende/path";
import { build, type PageData } from "./build.ts";

/** What `_config.ts` may export. */
export interface Config {
  /** Data every page receives. */
  data?: PageData;
  /** Where the site is written, relative to `src`. */
  dest?: string;
}

const USAGE = `Usage: satz build [--src <dir>] [--dest <dir>]

  --src   the site's source directory (default: .)
  --dest  where to write the site (default: _site in src)`;

/** Runs the CLI with `args` and returns the exit code. */
export async function main(args: string[]): Promise<number> {
  const flags = parseArgs(args, { alias: { h: "help" }, boolean: ["help"], string: ["src", "dest"] });
  const [command, ...rest] = flags._;

  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  if (command !== "build" || rest.length > 0) {
    console.error(USAGE);
    return 1;
  }

  const src = resolve(flags.src ?? ".");
  const config = await loadConfig(src);
  const dest = flags.dest !== undefined ?
    resolve(flags.dest) :
    resolve(src, config.dest ?? "_site");
  const start = performance.now();
  const pages = await build({ src, dest, data: config.data ?? {} });
  console.log(`Built ${pages.length} pages into ${dest} in ${Math.round(performance.now() - start)} ms`);

  return 0;
}

async function loadConfig(src: string): Promise<Config> {
  const path = join(src, "_config.ts");

  try {
    await Ende.stat(path);
  } catch (error) {
    if (error instanceof Ende.errors.NotFound)
      return {};

    throw error;
  }

  const config = (await import(toFileUrl(path).href)).default;

  if (typeof config !== "object" || config === null)
    throw new Error(`${path} must default-export an object`);

  return config;
}

if (import.meta.main)
  Ende.exit(await main(Ende.args));
