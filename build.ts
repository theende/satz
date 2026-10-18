// Copyright 2026 the Ende authors. MIT license.
import { extract } from "@ende/front-matter/yaml";
import { test as hasFrontMatter } from "@ende/front-matter/test";
import { copy } from "@ende/fs/copy";
import { emptyDir } from "@ende/fs/empty-dir";
import { ensureDir } from "@ende/fs/ensure-dir";
import { escape } from "@ende/html";
import { parse as parseMarkdown, render as renderMarkdown, toc, visit } from "@ende/markdown";
import type { Code, Html, Nodes, Root } from "@ende/markdown/types";
import { dirname, extname, isAbsolute, join, relative, resolve, SEPARATOR, toFileUrl } from "@ende/path";
import { parse as parseYaml } from "@ende/yaml/parse";
import { SEARCH_CLIENT } from "./_search_client.ts";
import { highlight } from "./highlight.ts";
import { raw, renderToString, type Child, type RawHtml } from "./jsx_runtime.ts";
import type { SearchEntry, SearchHeading } from "./search.ts";

/** Data available to a page: the `_data` cascade, then the page's own front matter or exports. */
export type PageData = Record<string, unknown>;

/** Options for {@linkcode build}. */
export interface BuildOptions {
  /** Data every page receives, below the `_data` files. */
  data?: PageData;
  /** Where the site is written. It is emptied first. Defaults to `_site`. */
  dest?: string;
  /**
   * The site's absolute URL, e.g. `https://docs.ende.sh`. With it, `build`
   * writes `/sitemap.xml`, and redirect pages link to their canonical URL.
   */
  location?: string;
  /**
   * Whether to write `/search.json`, the search index, and `/_satz/search.js`,
   * the `@ende/satz/search` module as JavaScript for the site's own scripts to
   * import.
   */
  search?: boolean;
  /** The site's source directory. Defaults to the current directory. */
  src?: string;
}

/** A page that {@linkcode build} wrote. */
export interface Page {
  /** The page's data. */
  data: PageData;
  /** The file written, relative to `dest`, with `/` separators. */
  dest: string;
  /** The old URLs (`oldUrl` in the page's data) that redirect to the page. */
  redirects: string[];
  /** The source file, relative to `src`, with `/` separators. */
  src: string;
  /** The page's URL, e.g. `/guide/intro/` or `/404.html`. */
  url: string;
}

/** The props a layout receives: the page data plus its rendered content. */
export interface LayoutProps extends PageData {
  /** The page's (or inner layout's) HTML. */
  content: RawHtml;
  /** Where the page came from. */
  page: { src: string; url: string; };
  /** The page's URL. */
  url: string;
}

interface PendingPage {
  data: PageData;
  dest: string;
  redirects: string[];
  /** Renders the page's content; `urls` maps every page's `src` to its URL. */
  render: (urls: Map<string, string>) => Promise<string>;
  /** For Markdown pages: what the search index gets beyond the title and description. */
  search?: { headings: SearchHeading[]; text: string; };
  src: string;
  url: string;
}

const DATA_FILES = ["_data.json", "_data.yaml", "_data.yml", "_data.ts"];
const PAGE_MODULE = /\.page\.tsx?$/;
const SCRIPT = /\.tsx?$/;

/** How much of a page's text the search index keeps. */
const SEARCH_TEXT_LIMIT = 2000;

/**
 * Builds the site in `src` into `dest`.
 *
 * - `.md` files and `.page.ts`/`.page.tsx` modules become pages. Other `.ts`
 *   and `.tsx` files are browser scripts: they're written as `.js` with their
 *   types stripped (by `ende transpile`, without type-checking), and relative
 *   imports of `.ts`/`.tsx` files point at the `.js` instead. `.d.ts` files are
 *   skipped. Everything else is copied as it is.
 * - Markdown pages get their headings as `toc` (from `@ende/markdown`'s
 *   `toc()`), and the first `#` heading as `title` when their front matter has
 *   none. Code blocks are highlighted (see `@ende/satz/highlight`), and a block
 *   whose fence has `title="…"` is wrapped in a `<figure class="code-block">`
 *   with the title as its `<figcaption>`.
 * - Files and directories whose names start with `_` or `.` are skipped, apart
 *   from `_data.*` files (merged into the data of every page below them) and
 *   `_includes/` (layouts).
 * - A page's `oldUrl` (a path or a list of them) writes a redirect page at
 *   each old URL, which works on any static host: `/old/` and `/old` write
 *   `old/index.html`, `/old.html` writes `old.html`.
 * - With a `location`, `/sitemap.xml` lists every HTML page apart from
 *   `/404.html` and pages whose data has `sitemap: false`, with `<lastmod>`
 *   from `last_modified` (a date or a string) when they have one.
 * - With `search`, `/search.json` lists the same pages (apart from those
 *   whose data has `search: false`) for `@ende/satz/search`: each page's URL,
 *   title, description, its headings below the title, and the first 2000 or so
 *   characters of its text, without code blocks. `/_satz/search.js` is that
 *   module, for the browser.
 *
 * @returns The pages written.
 */
export async function build(options: BuildOptions = {}): Promise<Page[]> {
  const dest = resolve(options.dest ?? "_site");
  const src = resolve(options.src ?? ".");

  // On Windows, `relative()` between drives is the absolute path of `src`.
  const fromDest = relative(dest, src);

  if (fromDest === "" || (!fromDest.startsWith("..") && !isAbsolute(fromDest)))
    throw new Error(`The dest directory ${dest} must not be or contain the src directory ${src}`);

  const location = options.location === undefined ? undefined : siteLocation(options.location);
  const files: { src: string; dest: string; }[] = [];
  const pages: PendingPage[] = [];
  const scripts: string[] = [];
  await scan(src, src, dest, options.data ?? {}, pages, files, scripts);

  const redirects = pages.flatMap(page => page.redirects.map(oldUrl => ({ dest: redirectPath(oldUrl), src: `${page.src} (oldUrl ${oldUrl})`, url: page.url })));
  const scriptOutputs = scripts.map(script => ({ dest: script.replace(SCRIPT, ".js"), src: script }));

  const generated = [
    ...(location === undefined ? [] : [{ dest: "sitemap.xml", src: "the sitemap" }]),
    ...(options.search ? [{ dest: "search.json", src: "the search index" }, { dest: "_satz/search.js", src: "satz's search client" }] : [])
  ];

  const outputs = new Map<string, string>();

  for (const { src: from, dest: to } of [...pages, ...redirects, ...files, ...scriptOutputs, ...generated]) {
    const previous = outputs.get(to);

    if (previous !== undefined)
      throw new Error(`${previous} and ${from} both write /${to}`);

    outputs.set(to, from);
  }

  // Transpiled before dest is emptied, so a script that doesn't parse leaves
  // the last build in place.
  const transpiled = scripts.length === 0 ? new Map<string, string>() : await transpile(src, scripts);

  // Source path → URL, for rewriting links to .md files.
  const urls = new Map(pages.map(page => [page.src, page.url]));
  await emptyDir(dest);

  for (const file of files) {
    await ensureDir(dirname(join(dest, file.dest)));
    await copy(join(src, file.src), join(dest, file.dest), { overwrite: true });
  }

  for (const page of pages) {
    let html = await applyLayouts(src, page, await page.render(urls));

    if (page.dest.endsWith(".html") && /^<html[\s>]/i.test(html))
      html = `<!DOCTYPE html>\n${html}`;

    await writeOutput(dest, page.dest, html);
  }

  for (const redirect of redirects) {
    await writeOutput(dest, redirect.dest, redirectPage(redirect.url, location));
  }

  for (const script of scriptOutputs) {
    await writeOutput(dest, script.dest, transpiled.get(script.src)!);
  }

  if (location !== undefined)
    await writeOutput(dest, "sitemap.xml", sitemap(pages, location));

  if (options.search) {
    await writeOutput(dest, "search.json", searchIndex(pages));
    await writeOutput(dest, "_satz/search.js", SEARCH_CLIENT);
  }

  return pages.map(({ url, src, dest, data, redirects }) => ({ url, src, dest, data, redirects }));
}

async function writeOutput(dest: string, file: string, text: string) {
  const path = join(dest, file);
  await ensureDir(dirname(path));
  await Ende.writeTextFile(path, text);
}

/** The location without a trailing `/`, so page URLs can be appended. */
function siteLocation(location: string): string {
  let url;

  try {
    url = new URL(location);
  } catch {
    // Reported below.
  }

  if (url === undefined || (url.protocol !== "https:" && url.protocol !== "http:"))
    throw new Error(`The site location ${JSON.stringify(location)} must be an absolute http(s) URL`);

  return location.replace(/\/+$/, "");
}

/** Reads a page's `oldUrl`: nothing, a path, or a list of paths. */
function oldUrls(rel: string, data: PageData): string[] {
  const value = data.oldUrl ?? [];
  const list = Array.isArray(value) ? value : [value];

  for (const oldUrl of list) {
    if (typeof oldUrl !== "string" || !oldUrl.startsWith("/"))
      throw new Error(`${rel} has oldUrl ${JSON.stringify(oldUrl)}, which must be a string starting with /`);
  }

  return list;
}

/** Where the redirect page for `oldUrl` goes: `.html` URLs are files, everything else a directory. */
function redirectPath(oldUrl: string): string {
  if (oldUrl.endsWith("/"))
    return `${oldUrl.slice(1)}index.html`;

  if (oldUrl.endsWith(".html"))
    return oldUrl.slice(1);

  return `${oldUrl.slice(1)}/index.html`;
}

function redirectPage(url: string, location: string | undefined): string {
  const to = escape(url);
  const canonical = escape((location ?? "") + url);

  return `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Redirecting to ${to}</title>` +
    `<meta http-equiv="refresh" content="0; url=${to}"><link rel="canonical" href="${canonical}"></head>` +
    `<body><p>This page has moved to <a href="${to}">${to}</a>.</p></body></html>\n`;
}

/** The HTML pages a sitemap or search index lists, apart from `/404.html`, by URL. */
function listedPages(pages: PendingPage[], key: "sitemap" | "search"): PendingPage[] {
  return pages
    .filter(page => page.dest.endsWith(".html") && page.dest !== "404.html" && page.data[key] !== false)
    .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

function sitemap(pages: PendingPage[], location: string): string {
  const entries = listedPages(pages, "sitemap")
    .map(page => {
      const lastmod = lastModified(page);
      return `<url><loc>${escape(location + page.url)}</loc>${lastmod === undefined ? "" : `<lastmod>${escape(lastmod)}</lastmod>`}</url>\n`;
    });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("")}</urlset>\n`;
}

function searchIndex(pages: PendingPage[]): string {
  const entries = listedPages(pages, "search").map(page => {
    const entry: SearchEntry = { url: page.url, title: typeof page.data.title === "string" ? page.data.title : page.url };

    if (typeof page.data.description === "string" && page.data.description !== "")
      entry.description = page.data.description;

    if (page.search !== undefined && page.search.headings.length > 0)
      entry.headings = page.search.headings;

    if (page.search !== undefined && page.search.text !== "")
      entry.text = page.search.text;

    return entry;
  });

  return JSON.stringify(entries);
}

// Blocks whose text is followed by a space, so words of adjacent blocks don't run together.
const TEXT_BLOCKS = new Set(["paragraph", "tableCell"]);

/**
 * The text of a Markdown page for the search index: no code blocks (they're
 * large, and their words make poor matches), no raw HTML, and no headings
 * (indexed on their own), cut at a word near {@linkcode SEARCH_TEXT_LIMIT}.
 */
function searchText(ast: Root): string {
  const parts: string[] = [];

  const walk = (node: Nodes) => {
    if (node.type === "code" || node.type === "html" || node.type === "heading")
      return;

    if (node.type === "text" || node.type === "inlineCode")
      parts.push(node.value);
    else if (node.type === "break")
      parts.push(" ");

    if ("children" in node) {
      for (const child of node.children) {
        walk(child);
      }
    }

    if (TEXT_BLOCKS.has(node.type))
      parts.push(" ");
  };

  walk(ast);
  const text = parts.join("").replace(/\s+/g, " ").trim();

  if (text.length <= SEARCH_TEXT_LIMIT)
    return text;

  const space = text.lastIndexOf(" ", SEARCH_TEXT_LIMIT);
  return text.slice(0, space > 0 ? space : SEARCH_TEXT_LIMIT);
}

/**
 * Transpiles `files` (relative to `cwd`, which they must be under) with one
 * `ende transpile`, which uses the `ende.json` it finds for them, and returns
 * each file's JavaScript with its relative `.ts`/`.tsx` imports pointing at
 * `.js`.
 */
async function transpile(cwd: string, files: string[]): Promise<Map<string, string>> {
  const outdir = await Ende.makeTempDir({ prefix: "satz-transpile-" });

  try {
    const { code, stderr } = await new Ende.Command(Ende.execPath(), {
      args: ["transpile", "--outdir", outdir, ...files],
      cwd,
      env: { NO_COLOR: "1" },
      stdout: "null",
      stderr: "piped"
    })
      .output();

    if (code !== 0) {
      const message = new TextDecoder().decode(stderr).split("\n").filter(line => !line.includes("is experimental")).join("\n").trim();
      throw new Error(`Could not transpile the browser scripts: ${message}`);
    }

    const outputs = new Map<string, string>();

    for (const file of files) {
      outputs.set(file, pointImportsAtJs(await Ende.readTextFile(join(outdir, file.replace(SCRIPT, ".js")))));
    }

    return outputs;
  } finally {
    await Ende.remove(outdir, { recursive: true });
  }
}

/**
 * Rewrites relative `.ts`/`.tsx` module specifiers (`from "./a.ts"`,
 * `import "./a.ts"`, `import("./a.ts")`) to `.js`. It works on the text, so a
 * string that merely looks like one of those is rewritten too.
 */
function pointImportsAtJs(code: string): string {
  return code.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.\.?\/[^"'\n]*?)\.tsx?\2/g, "$1$2$3.js$2");
}

/** `last_modified` as a sitemap date: YAML dates become `YYYY-MM-DD`, strings are kept. */
function lastModified(page: PendingPage): string | undefined {
  const value = page.data.last_modified;

  if (value === undefined || value === null)
    return undefined;

  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);

  if (typeof value === "string")
    return value;

  throw new Error(`${page.src} has last_modified ${JSON.stringify(value)}, which must be a date or a string`);
}

async function scan(
  root: string,
  dir: string,
  dest: string,
  inherited: PageData,
  pages: PendingPage[],
  files: { src: string; dest: string; }[],
  scripts: string[]
) {
  const data = { ...inherited, ...(await loadDataFiles(dir)) };
  const entries = [];

  for await (const entry of Ende.readDir(dir)) {
    entries.push(entry);
  }

  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (entry.name.startsWith("_") || entry.name.startsWith(".") || path === dest)
      continue;

    const rel = toPosix(relative(root, path));

    if (entry.isDirectory)
      await scan(root, path, dest, data, pages, files, scripts);
    else if (entry.name.endsWith(".md"))
      pages.push(await loadMarkdownPage(path, rel, data));
    else if (PAGE_MODULE.test(entry.name))
      pages.push(...(await loadModulePages(path, rel, data)));
    else if (entry.name.endsWith(".d.ts"))
      continue;
    else if (SCRIPT.test(entry.name))
      scripts.push(rel);
    else
      files.push({ dest: rel, src: rel });
  }
}

async function loadDataFiles(dir: string): Promise<PageData> {
  let data: PageData = {};

  for (const name of DATA_FILES) {
    const path = join(dir, name);
    let text;

    try {
      text = await Ende.readTextFile(path);
    } catch (error) {
      if (error instanceof Ende.errors.NotFound)
        continue;

      throw error;
    }

    let value: unknown;

    try {
      value = name.endsWith(".json") ?
        JSON.parse(text) :
        name.endsWith(".ts") ?
        (await import(toFileUrl(path).href)).default :
        parseYaml(text);
    } catch (error) {
      throw new Error(`Could not load ${path}: ${error instanceof Error ? error.message : error}`, { cause: error });
    }

    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error(`${path} must contain an object`);

    data = { ...data, ...value };
  }

  return data;
}

// Front matter is parsed while scanning, so every page's URL is known before
// any Markdown link is rewritten.
async function loadMarkdownPage(path: string, rel: string, inherited: PageData): Promise<PendingPage> {
  const text = await Ende.readTextFile(path);
  let attrs: PageData = {};
  let body = text;

  if (hasFrontMatter(text, ["yaml"])) {
    try {
      ({ attrs, body } = extract<PageData>(text));
    } catch (error) {
      throw new Error(`Could not parse the front matter of ${path}: ${error instanceof Error ? error.message : error}`, { cause: error });
    }
  }

  const ast = parseMarkdown(body, { gfm: true });
  captionCodeBlocks(ast);
  const headings = toc(ast);
  const data: PageData = { ...inherited, toc: headings, ...(attrs ?? {}) };

  if (data.title === undefined) {
    const heading = headings.find(entry => entry.depth === 1);

    if (heading !== undefined)
      data.title = heading.text;
  }

  const url = pageUrl(rel, data);

  const render = (urls: Map<string, string>) =>
    Promise.resolve(renderMarkdown(ast, { highlight: highlightCode, rewriteLink: href => rewriteMarkdownLink(href, rel, urls) }));

  return {
    data,
    dest: outputPath(rel, url),
    redirects: oldUrls(rel, data),
    render,
    search: { headings: headings.filter(heading => heading.depth > 1).map(({ text, slug }) => ({ text, slug })), text: searchText(ast) },
    src: rel,
    url
  };
}

function highlightCode(code: string, lang: string | null): string | undefined {
  return lang === null ? undefined : highlight(code, lang);
}

/** Replaces each code block whose fence has `title="…"` with its HTML, captioned. */
function captionCodeBlocks(ast: Root) {
  visit(ast, "code", (node, index, parent) => {
    const title = node.meta === null ? undefined : /(?:^|\s)title=(?:"([^"]*)"|'([^']*)')/.exec(node.meta);

    if (title === undefined || title === null || parent === null || index === null)
      return;

    const html: Html = {
      type: "html",
      value: `<figure class="code-block"><figcaption>${escape(title[1] ?? title[2]!)}</figcaption>${renderCode(node)}</figure>`
    };

    parent.children[index] = html;
  });
}

/** Renders a code block the way `@ende/markdown` does, highlighted. */
function renderCode(node: Code): string {
  const cls = node.lang === null ? "" : ` class="language-${escape(node.lang)}"`;
  const code = highlightCode(node.value, node.lang) ?? (node.value === "" ? "" : `${escape(node.value)}\n`);
  return `<pre><code${cls}>${code}</code></pre>`;
}

async function loadModulePages(path: string, rel: string, inherited: PageData): Promise<PendingPage[]> {
  const { default: main, ...exports } = await import(toFileUrl(path).href);

  if (typeof main !== "function")
    throw new Error(`${path} must have a default export that is a function`);

  const data = { ...inherited, ...exports };
  const isGenerator = main.constructor.name === "GeneratorFunction" || main.constructor.name === "AsyncGeneratorFunction";

  if (!isGenerator) {
    const url = pageUrl(rel, data);

    return [{
      data,
      dest: outputPath(rel, url),
      redirects: oldUrls(rel, data),
      render: () => renderContent(main({ ...data, url })),
      src: rel,
      url
    }];
  }

  const pages: PendingPage[] = [];

  for await (const item of main(data) as AsyncIterable<PageData>) {
    if (typeof item?.url !== "string")
      throw new Error(`${rel} yielded a page without a url`);

    const { content, ...rest } = item;
    const pageData = { ...data, ...rest };
    const url = pageUrl(rel, pageData);

    pages.push({
      data: pageData,
      dest: outputPath(rel, url),
      redirects: oldUrls(rel, pageData),
      render: () => renderContent(content as Child),
      src: rel,
      url
    });
  }

  return pages;
}

/** Strings are output as they are; anything else is rendered as JSX. */
async function renderContent(content: Child): Promise<string> {
  const value = (await content) as Child;
  return typeof value === "string" ? value : renderToString(value);
}

function pageUrl(rel: string, data: PageData): string {
  if (data.url !== undefined) {
    if (typeof data.url !== "string" || !data.url.startsWith("/"))
      throw new Error(`${rel} has url ${JSON.stringify(data.url)}, which must be a string starting with /`);

    return data.url;
  }

  const path = rel.replace(PAGE_MODULE, "").replace(/\.md$/, "");

  if (path === "index")
    return "/";

  return path.endsWith("/index") ?
    `/${path.slice(0, -"index".length)}` :
    `/${path}/`;
}

function outputPath(rel: string, url: string): string {
  if (url.endsWith("/"))
    return `${url.slice(1)}index.html`;

  if (extname(url) === "")
    throw new Error(`${rel} has url ${JSON.stringify(url)}, which must end with / or a file extension`);

  return url.slice(1);
}

function rewriteMarkdownLink(href: string, from: string, urls: Map<string, string>): string {
  if (/^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(href))
    return href;

  const hash = href.indexOf("#");
  const path = hash === -1 ? href : href.slice(0, hash);

  if (!path.endsWith(".md"))
    return href;

  const target = toPosix(join(dirname(from), decodeURI(path)));
  const url = urls.get(target);

  if (url === undefined)
    throw new Error(`${from} links to ${path}, which is not a page`);

  return url + (hash === -1 ? "" : href.slice(hash));
}

async function applyLayouts(src: string, page: PendingPage, html: string): Promise<string> {
  const seen = new Set<string>();
  let layout = page.data.layout;
  let user = page.src;

  while (layout !== undefined && layout !== null) {
    if (typeof layout !== "string")
      throw new Error(`${user} has a layout that is not a string`);

    if (seen.has(layout))
      throw new Error(`The layouts used by ${page.src} form a loop at ${layout}`);

    seen.add(layout);
    const path = join(src, "_includes", layout);
    let module;

    try {
      module = await import(toFileUrl(path).href);
    } catch (error) {
      throw new Error(`${user} uses layout ${layout}, which could not be loaded from ${path}: ${error instanceof Error ? error.message : error}`, {
        cause: error
      });
    }

    if (typeof module.default !== "function")
      throw new Error(`The layout ${path} must have a default export that is a function`);

    const props: LayoutProps = {
      ...page.data,
      content: raw(html),
      page: {
        src: page.src,
        url: page.url
      },
      url: page.url
    };

    html = await renderToString(module.default(props));
    user = `_includes/${layout}`;
    layout = module.layout;
  }

  return html;
}

function toPosix(path: string): string {
  return SEPARATOR === "/" ?
    path :
    path.replaceAll(SEPARATOR, "/");
}
