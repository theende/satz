// Copyright 2026 the Ende authors. MIT license.
// Runs one build for `satz serve`. Each build gets a new worker, so pages,
// layouts, `_data.ts`, `_config.ts` and everything they import are loaded
// fresh from disk.
import { build, type PageData } from "./build.ts";
import { loadConfig } from "./config.ts";

/** What `serve()` sends the worker. */
export interface BuildRequest {
  data: PageData;
  dest: string;
  location: string | undefined;
  src: string;
}

/** What the worker sends back: the page count and the redirects (old URL → URL), or the error. */
export type BuildResponse =
  | { ok: true; ms: number; pages: number; redirects: [string, string][]; }
  | { ok: false; error: string; };

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<BuildRequest>) => void) | null;
  postMessage(message: BuildResponse): void;
};

worker.onmessage = async ({ data: request }) => {
  try {
    const start = performance.now();
    const config = await loadConfig(request.src);
    const location = request.location ?? config.location;

    const pages = await build({
      src: request.src,
      dest: request.dest,
      data: { ...config.data, ...request.data },
      ...(location === undefined ? {} : { location }),
      ...(config.search === undefined ? {} : { search: config.search })
    });

    worker.postMessage({
      ok: true,
      ms: Math.round(performance.now() - start),
      pages: pages.length,
      redirects: pages.flatMap(page => page.redirects.map(oldUrl => [oldUrl, page.url] as [string, string]))
    });
  } catch (error) {
    worker.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
