// Copyright 2026 the Ende authors. MIT license.
import { serveDir } from "@ende/http/file-server";
import { basename, dirname, isAbsolute, join, relative, resolve, SEPARATOR } from "@ende/path";
import type { BuildRequest, BuildResponse } from "./_build_worker.ts";
import type { PageData } from "./build.ts";
import { loadConfig } from "./config.ts";

/** Options for {@linkcode serve}. */
export interface ServeOptions {
  /** Data every page receives, over `_config.ts`'s. It must be structured-cloneable. */
  data?: PageData;
  /** Where the site is written. Defaults to `_config.ts`'s `dest`, or `_site`, in `src`. */
  dest?: string;
  /** The interface to listen on. Defaults to `localhost`. */
  hostname?: string;
  /** The site's absolute URL. Defaults to `_config.ts`'s `location`. */
  location?: string;
  /** Called after every build, the first one included. */
  onBuild?: (report: BuildReport) => void;
  /** The port to listen on; `0` picks a free one. Defaults to 3000. */
  port?: number;
  /** The site's source directory. Defaults to the current directory. */
  src?: string;
}

/** How a build went. */
export type BuildReport = { ok: true; ms: number; pages: number; } | { ok: false; error: string; };

/** A running {@linkcode serve}. */
export interface SiteServer {
  /** The server's URL, e.g. `http://localhost:3000`. */
  url: string;
  /** Stops watching and serving. */
  close(): Promise<void>;
}

const RELOAD_PATH = "/_satz/reload";

// Added to every HTML response: reloads the page after a rebuild and shows a
// failed build's error.
const RELOAD_SCRIPT = `(() => {
  const events = new EventSource("${RELOAD_PATH}");
  events.addEventListener("reload", () => location.reload());
  events.addEventListener("build-error", event => {
    console.error(event.data);
    let box = document.getElementById("satz-build-error");
    if (box === null) {
      box = document.createElement("pre");
      box.id = "satz-build-error";
      box.style.cssText = "position:fixed;inset:auto 0 0 0;z-index:2147483647;margin:0;padding:1em;max-height:50vh;overflow:auto;" +
        "background:#300;color:#fdd;font:13px/1.4 monospace;white-space:pre-wrap";
      document.body.append(box);
    }
    box.textContent = "satz: the build failed\\n\\n" + event.data;
  });
})();`;

/**
 * Builds the site in `src`, serves it, and rebuilds it when a file in `src`
 * changes, reloading open pages. Each build runs in a new worker, so changed
 * modules (pages, layouts, components, `_data.ts`, `_config.ts`) are always
 * loaded fresh. A failed build keeps the last good one served and shows its
 * error in the browser.
 *
 * Old URLs from `oldUrl` answer with a 301, and missing files with
 * `/404.html` when the site has one.
 */
export async function serve(options: ServeOptions = {}): Promise<SiteServer> {
  const src = resolve(options.src ?? ".");
  const config = await loadConfig(src);
  const dest = options.dest !== undefined ?
    resolve(options.dest) :
    resolve(src, config.dest ?? "_site");
  const request = { data: options.data ?? {}, location: options.location, src };
  const onBuild = options.onBuild ?? (() => {});
  const clients = new Set<ReadableStreamDefaultController<string>>();
  let redirects = new Map<string, string>();
  let lastError: string | undefined;

  const send = (event: string, data: string) => {
    for (const client of clients) {
      client.enqueue(eventMessage(event, data));
    }
  };

  const rebuild = async () => {
    const response = await buildInto(dest, request);

    if (!response.ok) {
      lastError = response.error;
      send("build-error", response.error);
      onBuild(response);
      return;
    }

    redirects = new Map(response.redirects.map(([oldUrl, url]) => [redirectKey(oldUrl), url]));
    lastError = undefined;
    send("reload", "");
    onBuild({ ok: true, ms: response.ms, pages: response.pages });
  };

  await rebuild();

  const events = () => {
    let controller: ReadableStreamDefaultController<string>;

    const body = new ReadableStream<string>({
      start(c) {
        controller = c;
        clients.add(c);
        c.enqueue(eventMessage("connected", ""));

        if (lastError !== undefined)
          c.enqueue(eventMessage("build-error", lastError));
      },
      cancel() {
        clients.delete(controller);
      }
    });

    return new Response(body.pipeThrough(new TextEncoderStream()), {
      headers: { "cache-control": "no-store", "content-type": "text/event-stream" }
    });
  };

  const handler = async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);

    if (pathname === RELOAD_PATH)
      return events();

    const target = redirects.get(redirectKey(decodePath(pathname)));

    if (target !== undefined)
      return new Response(null, { status: 301, headers: { location: target } });

    let response = await serveDir(req, { fsRoot: dest, quiet: true });

    if (response.status === 404) {
      const notFound = await readIfExists(join(dest, "404.html"));

      if (notFound !== undefined) {
        await response.body?.cancel();
        response = new Response(notFound, { status: 404, headers: { "content-type": "text/html; charset=UTF-8" } });
      }
    }

    return withReloadScript(response);
  };

  const hostname = options.hostname ?? "localhost";
  const server = Ende.serve({ hostname, port: options.port ?? 3000, onListen: () => {} }, handler);

  const ignored = await ignoredPaths(src, dest);
  const watcher = Ende.watchFs(src, { recursive: true });
  let timer: number | undefined;
  let building: Promise<void> | undefined;
  let pending = false;

  // Changes during a build start another build after it.
  const run = async () => {
    timer = undefined;

    if (building !== undefined) {
      pending = true;
      return;
    }

    building = rebuild();
    await building;
    building = undefined;

    if (pending) {
      pending = false;
      schedule();
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, 100);
  };

  const watching = (async () => {
    for await (const event of watcher) {
      if (event.paths.some(path => !ignored(path)))
        schedule();
    }
  })();

  return {
    url: `http://${hostname}:${server.addr.port}`,
    close: async () => {
      watcher.close();
      await watching;
      clearTimeout(timer);
      await building;

      for (const client of clients) {
        client.close();
      }

      clients.clear();
      await server.shutdown();
    }
  };
}

function eventMessage(event: string, data: string): string {
  return `event: ${event}\ndata: ${data.split("\n").join("\ndata: ")}\n\n`;
}

/** Old URLs match with or without a trailing `/`. */
function redirectKey(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function decodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await Ende.readTextFile(path);
  } catch (error) {
    if (error instanceof Ende.errors.NotFound)
      return undefined;

    throw error;
  }
}

async function withReloadScript(response: Response): Promise<Response> {
  if (response.body === null || !response.headers.get("content-type")?.startsWith("text/html"))
    return response;

  const html = await response.text();
  const end = html.toLowerCase().lastIndexOf("</body>");
  const script = `<script>${RELOAD_SCRIPT}</script>`;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.delete("last-modified");
  headers.set("cache-control", "no-store");

  return new Response(end === -1 ? html + script : html.slice(0, end) + script + html.slice(end), {
    headers,
    status: response.status
  });
}

/**
 * Builds into a new directory next to `dest` and swaps it in when the build
 * succeeds, so a failed build leaves the last good one in place. The new
 * directory's name starts with `.`, so neither the build nor the watcher
 * looks at it when `dest` is inside `src`.
 */
async function buildInto(dest: string, request: Omit<BuildRequest, "dest">): Promise<BuildResponse> {
  const staging = join(dirname(dest), `.${basename(dest)}.satz-${crypto.randomUUID()}`);
  const response = await buildInWorker({ ...request, dest: staging });

  if (!response.ok) {
    await Ende.remove(staging, { recursive: true }).catch(() => {});
    return response;
  }

  const old = `${staging}.old`;
  let replaced = true;

  try {
    await Ende.rename(dest, old);
  } catch (error) {
    if (!(error instanceof Ende.errors.NotFound))
      throw error;

    replaced = false;
  }

  await Ende.rename(staging, dest);

  if (replaced)
    await Ende.remove(old, { recursive: true });

  return response;
}

function buildInWorker(request: BuildRequest): Promise<BuildResponse> {
  return new Promise(resolve => {
    const worker = new Worker(new URL("./_build_worker.ts", import.meta.url), { type: "module" });

    const finish = (response: BuildResponse) => {
      worker.terminate();
      resolve(response);
    };

    worker.onmessage = (event: MessageEvent<BuildResponse>) => finish(event.data);

    worker.onerror = event => {
      event.preventDefault();
      finish({ ok: false, error: event.message });
    };

    try {
      worker.postMessage(request);
    } catch (error) {
      finish({ ok: false, error: `Could not send the build options to the build worker: ${error instanceof Error ? error.message : error}` });
    }
  });
}

/**
 * Whether a changed path should not trigger a build: it's in `dest`, outside
 * `src`, or in a file or directory whose name starts with `.`. Watch events
 * can name paths through their real path (`/private/var` for `/var` on
 * macOS), so both spellings of `src` and `dest` are checked.
 */
async function ignoredPaths(src: string, dest: string): Promise<(path: string) => boolean> {
  const sources = [...new Set([src, await Ende.realPath(src)])];
  const dests = [...new Set([dest, await Ende.realPath(dest).catch(() => dest)])];
  // On Windows, `relative()` between drives is the absolute path itself.
  const inside = (dir: string, path: string) => {
    const rel = relative(dir, path);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  };

  return path => {
    if (dests.some(dir => inside(dir, path)))
      return true;

    const root = sources.find(dir => inside(dir, path));

    if (root === undefined)
      return true;

    return relative(root, path).split(SEPARATOR).some(part => part.startsWith("."));
  };
}
