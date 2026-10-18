// Copyright 2026 the Ende authors. MIT license.
/**
 * The satz command line.
 *
 * ```sh
 * ende run -A jsr:@ende/satz/cli build [--src <dir>] [--dest <dir>]
 * ende run -A jsr:@ende/satz/cli serve [--src <dir>] [--dest <dir>] [--port <port>]
 * ```
 *
 * `build` writes the site once. `serve` builds it, serves it, and rebuilds
 * and reloads open pages when a file in `src` changes; Ctrl-C stops it.
 *
 * An optional `<src>/_config.ts` can default-export `{ dest, data, location, search }`;
 * `dest` in it is relative to `src`, and the flags win over it.
 *
 * @module
 */
import { parseArgs } from "@ende/cli/parse-args";
import { resolve } from "@ende/path";
import { build } from "./build.ts";
import { loadConfig } from "./config.ts";
import { serve } from "./serve.ts";

export type { Config } from "./config.ts";

const USAGE = `Usage: satz build [--src <dir>] [--dest <dir>]
       satz serve [--src <dir>] [--dest <dir>] [--port <port>]

  --src   the site's source directory (default: .)
  --dest  where to write the site (default: _site in src)
  --port  the port to serve on (default: 3000)`;

/** Runs the CLI with `args` and returns the exit code. */
export async function main(args: string[]): Promise<number> {
  const flags = parseArgs(args, { alias: { h: "help" }, boolean: ["help"], string: ["src", "dest", "port"] });
  const [command, ...rest] = flags._;

  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  const port = flags.port === undefined ? 3000 : Number(flags.port);

  if ((command !== "build" && command !== "serve") || rest.length > 0 || !Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(USAGE);
    return 1;
  }

  const src = resolve(flags.src ?? ".");
  const config = await loadConfig(src);
  const dest = flags.dest !== undefined ?
    resolve(flags.dest) :
    resolve(src, config.dest ?? "_site");

  if (command === "serve")
    return await serveUntilInterrupted(src, dest, port);

  const start = performance.now();

  const pages = await build({
    src,
    dest,
    data: config.data ?? {},
    ...(config.location === undefined ? {} : { location: config.location }),
    ...(config.search === undefined ? {} : { search: config.search })
  });

  console.log(`Built ${pages.length} pages into ${dest} in ${Math.round(performance.now() - start)} ms`);

  return 0;
}

async function serveUntilInterrupted(src: string, dest: string, port: number): Promise<number> {
  const server = await serve({
    src,
    dest,
    port,
    onBuild: report => {
      if (report.ok)
        console.log(`Built ${report.pages} pages in ${report.ms} ms`);
      else
        console.error(`The build failed: ${report.error}`);
    }
  });

  console.log(`Serving ${dest} at ${server.url}/ (Ctrl-C to stop)`);

  await new Promise<void>(resolve => {
    const stop = () => {
      Ende.removeSignalListener("SIGINT", stop);
      resolve();
    };

    Ende.addSignalListener("SIGINT", stop);
  });

  await server.close();

  return 0;
}

if (import.meta.main)
  Ende.exit(await main(Ende.args));
