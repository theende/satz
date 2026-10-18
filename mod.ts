// Copyright 2026 the Ende authors. MIT license.
/**
 * satz is a static site generator for Ende, built on the `@ende/*` standard
 * library. Markdown pages (with YAML front matter) and `.page.tsx` modules are
 * rendered through TSX layouts into plain HTML.
 *
 * ```ts no-eval
 * import { build } from "@ende/satz";
 *
 * const pages = await build({ src: "docs", dest: "_site" });
 * console.log(`Built ${pages.length} pages`);
 * ```
 *
 * Or from the command line: `ende run -A jsr:@ende/satz/cli build`.
 *
 * @module
 */
export * from "./build.ts";
export * from "./serve.ts";
