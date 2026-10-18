// Copyright 2026 the Ende authors. MIT license.
import { extract } from "@ende/front-matter/yaml";
import { test as hasFrontMatter } from "@ende/front-matter/test";
import { copy } from "@ende/fs/copy";
import { emptyDir } from "@ende/fs/empty-dir";
import { ensureDir } from "@ende/fs/ensure-dir";
import { parse as parseMarkdown, render as renderMarkdown } from "@ende/markdown";
import { dirname, extname, join, relative, resolve, SEPARATOR, toFileUrl } from "@ende/path";
import { parse as parseYaml } from "@ende/yaml/parse";
import { raw, renderToString, type Child, type RawHtml } from "./jsx_runtime.ts";

/** Data available to a page: the `_data` cascade, then the page's own front matter or exports. */
export type PageData = Record<string, unknown>;

/** Options for {@linkcode build}. */
export interface BuildOptions {
  /** Data every page receives, below the `_data` files. */
  data?: PageData;
  /** Where the site is written. It is emptied first. Defaults to `_site`. */
  dest?: string;
  /** The site's source directory. Defaults to the current directory. */
  src?: string;
}

/** A page that {@linkcode build} wrote. */
export interface Page {
  /** The page's data. */
  data: PageData;
  /** The file written, relative to `dest`, with `/` separators. */
  dest: string;
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
  /** Renders the page's content; `urls` maps every page's `src` to its URL. */
  render: (urls: Map<string, string>) => Promise<string>;
  src: string;
  url: string;
}

const DATA_FILES = ["_data.json", "_data.yaml", "_data.yml", "_data.ts"];
const PAGE_MODULE = /\.page\.tsx?$/;

/**
 * Builds the site in `src` into `dest`.
 *
 * - `.md` files and `.page.ts`/`.page.tsx` modules become pages; other files
 *   are copied as they are.
 * - Files and directories whose names start with `_` or `.` are skipped, apart
 *   from `_data.*` files (merged into the data of every page below them) and
 *   `_includes/` (layouts).
 *
 * @returns The pages written.
 */
export async function build(options: BuildOptions = {}): Promise<Page[]> {
  const dest = resolve(options.dest ?? "_site");
  const src = resolve(options.src ?? ".");

  if (dest === src || !relative(dest, src).startsWith(".."))
    throw new Error(`The dest directory ${dest} must not be or contain the src directory ${src}`);

  const files: { src: string; dest: string; }[] = [];
  const pages: PendingPage[] = [];
  await scan(src, src, dest, options.data ?? {}, pages, files);

  const outputs = new Map<string, string>();

  for (const { src: from, dest: to } of [...pages, ...files]) {
    const previous = outputs.get(to);

    if (previous !== undefined)
      throw new Error(`${previous} and ${from} both write /${to}`);

    outputs.set(to, from);
  }

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

    const path = join(dest, page.dest);
    await ensureDir(dirname(path));
    await Ende.writeTextFile(path, html);
  }

  return pages.map(({ url, src, dest, data }) => ({ url, src, dest, data }));
}

async function scan(root: string, dir: string, dest: string, inherited: PageData, pages: PendingPage[], files: { src: string; dest: string; }[]) {
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
      await scan(root, path, dest, data, pages, files);
    else if (entry.name.endsWith(".md"))
      pages.push(await loadMarkdownPage(path, rel, data));
    else if (PAGE_MODULE.test(entry.name))
      pages.push(...(await loadModulePages(path, rel, data)));
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

  const data = { ...inherited, ...(attrs ?? {}) };
  const url = pageUrl(rel, data);

  const render = (urls: Map<string, string>) =>
    Promise.resolve(renderMarkdown(parseMarkdown(body, { gfm: true }), { rewriteLink: href => rewriteMarkdownLink(href, rel, urls) }));

  return {
    data,
    dest: outputPath(rel, url),
    render,
    src: rel,
    url
  };
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
