// Copyright 2026 the Ende authors. MIT license.
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@ende/assert";
import { walk } from "@ende/fs/walk";
import { join, relative, SEPARATOR, toFileUrl } from "@ende/path";
import { build, type Page } from "./build.ts";

const FIXTURE = join(import.meta.dirname!, "tests", "fixtures", "basic");

async function buildFixture(): Promise<{ dest: string; read: (path: string) => Promise<string>; }> {
  const dest = await Ende.makeTempDir();
  await build({ src: FIXTURE, dest });
  return { dest, read: path => Ende.readTextFile(join(dest, path)) };
}

// Lists the files under `dir` as `/`-separated relative paths, on every OS.
async function listFiles(dir: string): Promise<string[]> {
  const files = [];

  for await (const entry of walk(dir, { includeDirs: false })) {
    files.push(relative(dir, entry.path).replaceAll(SEPARATOR, "/"));
  }

  return files.sort();
}

async function writeSite(files: Record<string, string>): Promise<string> {
  const src = await Ende.makeTempDir();

  for (const [path, text] of Object.entries(files)) {
    await Ende.mkdir(join(src, path, ".."), { recursive: true });
    await Ende.writeTextFile(join(src, path), text);
  }

  return src;
}

Ende.test("build() writes pages and static files, skipping _ and . entries", async () => {
  const { dest } = await buildFixture();

  assertEquals(await listFiles(dest), [
    "404.html",
    "about/index.html",
    "feed.xml",
    "guide/deep/override/index.html",
    "guide/deep/page/index.html",
    "guide/intro/index.html",
    "index.html",
    "robots.txt",
    "static/logo.svg",
    "tags/a/index.html",
    "tags/b/index.html"
  ]);
});

Ende.test("build() renders Markdown through a layout chain and rewrites .md links", async () => {
  const { read } = await buildFixture();

  assertEquals(
    await read("index.html"),
    `<!DOCTYPE html>\n<html><head><title>Home | Satz</title></head><body><main data-section="root"><h1>Home</h1>` +
      `<p>See <a href="/guide/intro/#setup">the guide</a>.</p>\n</main></body></html>`
  );
  assertEquals(
    await read("guide/intro/index.html"),
    `<!DOCTYPE html>\n<html><head><title>Intro | Satz</title></head><body><main data-section="guide"><h1>Intro</h1>` +
      `<h2 id="setup">Setup</h2>\n<p>Back <a href="/">home</a>, on to <a href="/guide/deep/page/">deep</a>, ` +
      `or <a href="https://ende.sh/x.md">elsewhere</a>.</p>\n</main></body></html>`
  );
});

Ende.test("build() cascades _data files and lets front matter win", async () => {
  const { read } = await buildFixture();
  const page = await read("guide/deep/page/index.html");
  assertEquals(page.includes(`<title>Default title | Satz</title>`), true);
  assertEquals(page.includes(`<main data-section="guide">`), true);
  const override = await read("guide/deep/override/index.html");
  assertEquals(override.includes(`<title>Override | Satz</title>`), true);
  assertEquals(override.includes(`<main data-section="custom">`), true);
});

Ende.test("build() renders .page.tsx modules, generators and non-HTML URLs", async () => {
  const { read } = await buildFixture();
  assertEquals(await read("about/index.html"), `<!DOCTYPE html>\n<html><head><title>About | Satz</title></head><body><p>About Satz</p></body></html>`);
  assertEquals(await read("tags/b/index.html"), `<!DOCTYPE html>\n<html><head><title>Tag b | Satz</title></head><body><p>b</p></body></html>`);
  assertEquals(await read("feed.xml"), `<feed title="Satz"/>\n`);
  assertEquals(
    await read("404.html"),
    `<!DOCTYPE html>\n<html><head><title>Not found | Satz</title></head><body><p>Nothing here.</p>\n</body></html>`
  );
});

Ende.test("build() returns the pages it wrote", async () => {
  const dest = await Ende.makeTempDir();
  const pages = await build({ src: FIXTURE, dest });
  assertEquals(pages.map(p => p.url).sort(), [
    "/",
    "/404.html",
    "/about/",
    "/feed.xml",
    "/guide/deep/override/",
    "/guide/deep/page/",
    "/guide/intro/",
    "/tags/a/",
    "/tags/b/"
  ]);
  assertEquals(pages.find(p => p.url === "/tags/a/")?.src, "tags.page.tsx");
});

Ende.test("build() passes site data to every page", async () => {
  const src = await writeSite({ "a.page.ts": `export default ({ name }) => String(name);\n` });
  const dest = await Ende.makeTempDir();
  await build({ src, dest, data: { name: "from options" } });
  assertEquals(await Ende.readTextFile(join(dest, "a", "index.html")), "from options");
});

Ende.test("build() rejects a dest that is or contains src, and accepts one beside it", async () => {
  const src = await writeSite({ "index.md": "hi\n" });
  await assertRejects(() => build({ src, dest: src }), Error, "must not be or contain the src directory");
  await assertRejects(() => build({ src, dest: join(src, "..") }), Error, "must not be or contain the src directory");
  await build({ src, dest: `${src}-site` });
  assertEquals(await Ende.readTextFile(join(`${src}-site`, "index.html")), "<p>hi</p>\n");
});

Ende.test("build() rejects two pages with the same URL", async () => {
  const src = await writeSite({ "a.md": "---\nurl: /x/\n---\n", "b.md": "---\nurl: /x/\n---\n" });
  await assertRejects(() => build({ src, dest: join(src, "_site") }), Error, "a.md and b.md both write /x/index.html");
});

Ende.test("build() rejects outputs whose paths differ only in case", async () => {
  // They'd be one file on a case-insensitive file system (macOS, Windows).
  const src = await writeSite({ "a.md": "---\nurl: /Name/\n---\n", "b.md": "---\nurl: /name/\n---\n" });
  await assertRejects(
    () => build({ src, dest: join(src, "_site") }),
    Error,
    "a.md writes /Name/index.html and b.md writes /name/index.html, which differ only in case"
  );
});

Ende.test("build() rejects a link to a missing Markdown page", async () => {
  const src = await writeSite({ "a.md": "[b](b.md)\n" });
  await assertRejects(() => build({ src, dest: join(src, "_site") }), Error, "a.md links to b.md, which is not a page");
});

Ende.test("build() rejects a missing layout", async () => {
  const src = await writeSite({ "a.md": "---\nlayout: nope.tsx\n---\n" });
  await assertRejects(() => build({ src, dest: join(src, "_site") }), Error, "a.md uses layout nope.tsx");
});

Ende.test("build() rejects a URL without a trailing slash or extension", async () => {
  const src = await writeSite({ "a.md": "---\nurl: /x\n---\n" });
  await assertRejects(() => build({ src, dest: join(src, "_site") }), Error, `a.md has url "/x"`);
});

Ende.test("build() rejects a generated page without a url", async () => {
  const src = await writeSite({ "g.page.ts": "export default function* () { yield { title: 'x' }; }\n" });
  await assertRejects(() => build({ src, dest: join(src, "_site") }), Error, "g.page.ts yielded a page without a url");
});

Ende.test("build() refuses to write into the source directory itself", async () => {
  const src = await writeSite({ "a.md": "a\n" });
  await assertRejects(() => build({ src, dest: src }), Error, "dest");
});

async function buildSite(files: Record<string, string>): Promise<{ pages: Page[]; read: (path: string) => Promise<string>; }> {
  const src = await writeSite(files);
  const dest = join(src, "_site");
  const pages = await build({ src, dest });
  return { pages, read: path => Ende.readTextFile(join(dest, path)) };
}

Ende.test("build() highlights code blocks in languages it knows and escapes the rest", async () => {
  const { read } = await buildSite({ "a.md": "```ts\nlet a = 1;\n```\n\n```hcl\nx = \"<y>\"\n```\n\n```\nplain <b>\n```\n" });

  assertEquals(
    await read("a/index.html"),
    `<pre><code class="language-ts"><span class="hl-keyword">let</span> a <span class="hl-operator">=</span> <span class="hl-number">1</span><span class="hl-punctuation">;</span></code></pre>\n` +
      `<pre><code class="language-hcl">x = &quot;&lt;y&gt;&quot;\n</code></pre>\n` +
      `<pre><code>plain &lt;b&gt;\n</code></pre>\n`
  );
});

Ende.test("build() gives a code block with a title= in its fence a caption", async () => {
  const { read } = await buildSite({ "a.md": "```json title=\"a & b.json\"\n{}\n```\n\n- ```sh title='run.sh' ignore\n  ls\n  ```\n" });

  assertEquals(
    await read("a/index.html"),
    `<figure class="code-block"><figcaption>a &amp; b.json</figcaption><pre><code class="language-json"><span class="hl-punctuation">{</span><span class="hl-punctuation">}</span></code></pre></figure>\n` +
      `<ul>\n<li>\n<figure class="code-block"><figcaption>run.sh</figcaption><pre><code class="language-sh"><span class="hl-function">ls</span></code></pre></figure>\n</li>\n</ul>\n`
  );
});

Ende.test("build() gives Markdown pages their headings as toc", async () => {
  const { pages } = await buildSite({ "a.md": "# A\n\n## B *c*\n\n### D\n\n## B *c*\n" });

  assertEquals(pages[0]!.data.toc, [
    { depth: 1, text: "A", slug: "a" },
    { depth: 2, text: "B c", slug: "b-c" },
    { depth: 3, text: "D", slug: "d" },
    { depth: 2, text: "B c", slug: "b-c-1" }
  ]);
});

Ende.test("build() takes a Markdown page's title from its first # heading unless front matter sets one", async () => {
  const { pages } = await buildSite({
    "a.md": "Intro\n\n## Not this\n\n# The *title*\n\n# Not this either\n",
    "b.md": "---\ntitle: Set\n---\n# Heading\n",
    "c.md": "## Only h2\n"
  });
  const titles = Object.fromEntries(pages.map(page => [page.src, page.data.title]));

  assertEquals(titles, { "a.md": "The title", "b.md": "Set", "c.md": undefined });
});

Ende.test("build() renders real docs pages with highlighted, titled code, alerts and a toc", async () => {
  const dest = await Ende.makeTempDir();
  await build({ src: join(import.meta.dirname!, "tests", "fixtures", "docs"), dest });
  const html = await Ende.readTextFile(join(dest, "doc_tests", "index.html"));

  assert(html.startsWith(`<!DOCTYPE html>\n<html lang="en"><head><title>Documentation tests</title></head>`), html.slice(0, 120));
  assertStringIncludes(html, `<nav><a href="#example-code-blocks">Example code blocks</a>`);
  assertStringIncludes(html, `<figure class="code-block"><figcaption>example.ts</figcaption><pre><code class="language-ts"><span class="hl-comment">/**`);
  assertStringIncludes(html, `<figcaption>example.ts$4-10.ts</figcaption>`);
  assertStringIncludes(html, `<div class="markdown-alert markdown-alert-tip">`);
  assertStringIncludes(html, `<span class="hl-function">deno</span> test <span class="hl-attr">--doc</span>`);

  const run = await Ende.readTextFile(join(dest, "run", "index.html"));
  assertStringIncludes(run, `<div class="markdown-alert markdown-alert-caution">`);
  assertStringIncludes(run, `<figcaption>main.ts</figcaption><pre><code class="language-ts"><span class="hl-builtin">console</span>`);
});

Ende.test("build() writes a redirect page at each oldUrl, in the forms the docs use", async () => {
  const { pages, read } = await buildSite({
    "a.md": "---\noldUrl: /old/a/\n---\n",
    "b.md": "---\noldUrl:\n  - /old/b\n  - /old/b.html\n  - /old/b.md\n---\n",
    "c.md": "---\noldUrl:\n---\n"
  });

  assertEquals(
    await read("old/a/index.html"),
    `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Redirecting to /a/</title>` +
      `<meta http-equiv="refresh" content="0; url=/a/"><link rel="canonical" href="/a/"></head>` +
      `<body><p>This page has moved to <a href="/a/">/a/</a>.</p></body></html>\n`
  );
  assertStringIncludes(await read("old/b/index.html"), `url=/b/`);
  assertStringIncludes(await read("old/b.html"), `url=/b/`);
  assertStringIncludes(await read("old/b.md/index.html"), `url=/b/`);
  assertEquals(Object.fromEntries(pages.map(page => [page.src, page.redirects])), {
    "a.md": ["/old/a/"],
    "b.md": ["/old/b", "/old/b.html", "/old/b.md"],
    "c.md": []
  });
});

Ende.test("build() points a redirect's canonical link at the site's location", async () => {
  const src = await writeSite({ "a.md": "---\noldUrl: /old/\n---\n" });
  const dest = join(src, "_site");
  await build({ src, dest, location: "https://docs.ende.sh/" });
  assertStringIncludes(await Ende.readTextFile(join(dest, "old", "index.html")), `<link rel="canonical" href="https://docs.ende.sh/a/">`);
});

Ende.test("build() rejects a redirect that clashes with a page or another redirect", async () => {
  const page = await writeSite({ "a.md": "---\noldUrl: /b/\n---\n", "b.md": "b\n" });
  await assertRejects(() => build({ src: page, dest: join(page, "_site") }), Error, "b.md and a.md (oldUrl /b/) both write /b/index.html");

  const redirect = await writeSite({ "a.md": "---\noldUrl: /old\n---\n", "b.md": "---\noldUrl: /old/\n---\n" });
  await assertRejects(
    () => build({ src: redirect, dest: join(redirect, "_site") }),
    Error,
    "a.md (oldUrl /old) and b.md (oldUrl /old/) both write /old/index.html"
  );
});

Ende.test("build() rejects an oldUrl that isn't an absolute path", async () => {
  const src = await writeSite({ "a.md": "---\noldUrl: runtime/tutorials/kinsta\n---\n" });
  await assertRejects(
    () => build({ src, dest: join(src, "_site") }),
    Error,
    `a.md has oldUrl "runtime/tutorials/kinsta", which must be a string starting with /`
  );
});

Ende.test("build() writes sitemap.xml with every HTML page when the site has a location", async () => {
  const src = await writeSite({
    "index.md": "---\nlast_modified: 2026-09-30\n---\n",
    "b&c.md": "---\nlast_modified: \"2026-10-01T12:00:00Z\"\n---\n",
    "a.md": "---\noldUrl: /old/\n---\n",
    "hidden.md": "---\nsitemap: false\n---\n",
    "404.md": "---\nurl: /404.html\n---\nNot found\n",
    "feed.page.ts": `export const url = "/feed.xml";\nexport default () => "<feed/>";\n`
  });
  const dest = join(src, "_site");
  await build({ src, dest, location: "https://docs.ende.sh" });

  assertEquals(
    await Ende.readTextFile(join(dest, "sitemap.xml")),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `<url><loc>https://docs.ende.sh/</loc><lastmod>2026-09-30</lastmod></url>\n` +
      `<url><loc>https://docs.ende.sh/a/</loc></url>\n` +
      `<url><loc>https://docs.ende.sh/b&amp;c/</loc><lastmod>2026-10-01T12:00:00Z</lastmod></url>\n` +
      `</urlset>\n`
  );
});

Ende.test("build() writes no sitemap without a location", async () => {
  const src = await writeSite({ "a.md": "a\n" });
  const dest = join(src, "_site");
  await build({ src, dest });
  await assertRejects(() => Ende.stat(join(dest, "sitemap.xml")), Ende.errors.NotFound);
});

Ende.test("build() rejects a location that isn't an absolute URL", async () => {
  const src = await writeSite({ "a.md": "a\n" });
  await assertRejects(
    () => build({ src, dest: join(src, "_site"), location: "docs.ende.sh" }),
    Error,
    `location "docs.ende.sh" must be an absolute http(s) URL`
  );
});

Ende.test("build() emits browser scripts as JavaScript, pointing relative .ts imports at .js", async () => {
  const src = await writeSite({
    "js/main.ts": [
      `import { b } from "./lib/b.ts";`,
      `import "./side.ts";`,
      `import type { T } from "./types.ts";`,
      `import { x } from "jsr:@ende/x";`,
      `import y from "https://example.com/y.ts";`,
      `export * from "../other/c.tsx";`,
      `export const lazy = () => import("./lazy.ts");`,
      `export const n: number = 1;`,
      `console.log(b, x, y, "" as T);`
    ]
      .join("\n"),
    "js/lib/b.ts": `export const b: string = "b";\n`,
    "js/side.ts": `console.log("side");\n`,
    "js/lazy.ts": `export default 1;\n`,
    "js/types.ts": `export type T = string;\n`,
    "js/env.d.ts": `declare const ENV: string;\n`,
    "other/c.tsx": `export const c: string = "c";\n`
  });
  const dest = join(src, "_site");
  await build({ src, dest });

  assertEquals(await listFiles(dest), ["js/lazy.js", "js/lib/b.js", "js/main.js", "js/side.js", "js/types.js", "other/c.js"]);

  const main = await Ende.readTextFile(join(dest, "js", "main.js"));

  for (
    const part of [
      `from "./lib/b.js"`,
      `import "./side.js"`,
      `from "../other/c.js"`,
      `import("./lazy.js")`,
      `from "jsr:@ende/x"`,
      `from "https://example.com/y.ts"`,
      "export const n = 1;"
    ]
  ) {
    assertStringIncludes(main, part);
  }

  assert(!main.includes("import type"), main);
});

// `ende transpile` lays out its output under the inputs' common directory, so
// scripts that all sit in one directory lose that prefix there.
Ende.test("build() emits browser scripts that share one directory at their own paths", async () => {
  const src = await writeSite({ "js/a/one.ts": "export const one: number = 1;\n", "js/two.ts": "export const two: number = 2;\n" });
  const dest = join(src, "_site");
  await build({ src, dest });

  assertEquals(await listFiles(dest), ["js/a/one.js", "js/two.js"]);
  assertStringIncludes(await Ende.readTextFile(join(dest, "js", "a", "one.js")), "export const one = 1;");
});

Ende.test("build() emits a lone browser script at its own path", async () => {
  const src = await writeSite({ "js/a/one.ts": "export const one: number = 1;\n" });
  const dest = join(src, "_site");
  await build({ src, dest });

  assertEquals(await listFiles(dest), ["js/a/one.js"]);
});

Ende.test("build() rejects a browser script whose .js clashes with a file", async () => {
  const src = await writeSite({ "js/main.ts": "export {};\n", "js/main.js": "export {};\n" });
  await assertRejects(() => build({ src, dest: join(src, "_site") }), Error, "js/main.js and js/main.ts both write /js/main.js");
});

Ende.test("build() fails with the transpiler's message when a browser script doesn't parse", async () => {
  const src = await writeSite({ "js/bad.ts": "const x: = ;\n" });
  const error = await assertRejects(() => build({ src, dest: join(src, "_site") }), Error, "Could not transpile the browser scripts");
  assertStringIncludes(error.message, "bad.ts");
});

const SEARCH_SITE = {
  "index.md": "# Home\n\nWelcome *text*.\n\n## Install it\n\n```sh\nende install\n```\n\nRun `ende`.\n",
  "guide.md": "---\ntitle: The guide\ndescription: How it works\n---\nA line\nand another.\n\n- one\n- two\n",
  "hidden.md": "---\nsearch: false\n---\n# Hidden\n",
  "404.md": "---\nurl: /404.html\n---\n# Not found\n",
  "moved.md": "---\noldUrl: /old/\n---\n# Moved\n",
  "about.page.tsx": `export const title = "About";\nexport const description = "Who";\nexport default () => <p>about</p>;\n`,
  "feed.page.ts": `export const url = "/feed.xml";\nexport default () => "<feed/>";\n`
};

Ende.test("build() writes a compact search.json of the HTML pages when search is on", async () => {
  const src = await writeSite(SEARCH_SITE);
  const dest = join(src, "_site");
  await build({ src, dest, search: true });

  const json = await Ende.readTextFile(join(dest, "search.json"));
  assertEquals(json, JSON.stringify(JSON.parse(json)));
  assertEquals(JSON.parse(json), [
    { url: "/", title: "Home", headings: [{ text: "Install it", slug: "install-it" }], text: "Welcome text. Run ende." },
    { url: "/about/", title: "About", description: "Who" },
    { url: "/guide/", title: "The guide", description: "How it works", text: "A line and another. one two" },
    { url: "/moved/", title: "Moved" }
  ]);
});

Ende.test("build() cuts a search entry's text at a word after 2000 characters", async () => {
  const src = await writeSite({ "long.md": "word ".repeat(600) + "\n" });
  const dest = join(src, "_site");
  await build({ src, dest, search: true });

  const [entry] = JSON.parse(await Ende.readTextFile(join(dest, "search.json")));
  assert(entry.text.length <= 2000, String(entry.text.length));
  assert(entry.text.length > 1990, String(entry.text.length));
  assert(entry.text.endsWith("word"), entry.text.slice(-10));
});

Ende.test("build() writes no search index or client without search", async () => {
  const src = await writeSite({ "a.md": "a\n" });
  const dest = join(src, "_site");
  await build({ src, dest });
  assertEquals(await listFiles(dest), ["a/index.html"]);
});

Ende.test("build() writes the search client to /_satz/search.js as an ES module", async () => {
  const src = await writeSite(SEARCH_SITE);
  const dest = join(src, "_site");
  await build({ src, dest, search: true });

  const client = await import(toFileUrl(join(dest, "_satz", "search.js")).href);
  const entries = JSON.parse(await Ende.readTextFile(join(dest, "search.json")));
  assertEquals(client.search(entries, "instal")[0]?.url, "/#install-it");
});

Ende.test("build() rejects a page at the search client's reserved path", async () => {
  const src = await writeSite({ "x.page.ts": `export const url = "/_satz/search.js";\nexport default () => "";\n` });
  await assertRejects(() => build({ src, dest: join(src, "_site"), search: true }), Error, "both write /_satz/search.js");
});

Ende.test("build() skips the ignored files and directories", async () => {
  const src = await writeSite({ "README.md": "r\n", "docs/a.md": "a\n", "tools/x_test.ts": "export {};\n", "tools2/b.md": "b\n" });
  const dest = join(src, "_site");
  await build({ src, dest, ignore: ["README.md", "tools/"] });
  assertEquals(await listFiles(dest), ["docs/a/index.html", "tools2/b/index.html"]);
});

Ende.test("build() copies the copy directories verbatim to their output paths", async () => {
  const src = await writeSite({
    "static/favicon.ico": "ico",
    "static/img/a.svg": "<svg/>",
    "static/.nojekyll": "",
    "scripts/hello.ts": "const a: number = 1;\n",
    "index.md": "i\n"
  });
  const dest = join(src, "_site");
  await build({ src, dest, copy: { static: "/", scripts: "/examples/scripts/" } });
  assertEquals(await listFiles(dest), [".nojekyll", "examples/scripts/hello.ts", "favicon.ico", "img/a.svg", "index.html"]);
  assertEquals(await Ende.readTextFile(join(dest, "examples", "scripts", "hello.ts")), "const a: number = 1;\n");
});

Ende.test("build() copies a single file to its output path", async () => {
  const src = await writeSite({ "x/robots.txt": "r" });
  const dest = join(src, "_site");
  await build({ src, dest, copy: { "x/robots.txt": "/robots.txt" } });
  assertEquals(await listFiles(dest), ["robots.txt"]);
});

Ende.test("build() rejects a copied file that clashes with a page", async () => {
  const src = await writeSite({ "static/a/index.html": "x", "a.md": "a\n" });
  await assertRejects(
    () => build({ src, dest: join(src, "_site"), copy: { static: "/" } }),
    Error,
    "a.md and static/a/index.html (copied) both write /a/index.html"
  );
});

Ende.test("build() rejects a copy source that doesn't exist or an output path without a leading /", async () => {
  const src = await writeSite({ "a.md": "a\n" });
  await assertRejects(() => build({ src, dest: join(src, "_site"), copy: { missing: "/" } }), Error, `copy source "missing"`);
  await assertRejects(() => build({ src, dest: join(src, "_site"), copy: { "a.md": "a.md" } }), Error, `copy output "a.md" for "a.md" must start with /`);
});

Ende.test("build() writes redirect pages for the redirects map, fragments and external URLs included", async () => {
  const src = await writeSite({ "a.md": "a\n" });
  const dest = join(src, "_site");
  const pages = await build({ src, dest, redirects: { "/": "/a/", "/go/flag/": "/a/#flag", "/old": "https://example.com/x" } });
  assertStringIncludes(await Ende.readTextFile(join(dest, "index.html")), `url=/a/"`);
  assertStringIncludes(await Ende.readTextFile(join(dest, "go", "flag", "index.html")), `url=/a/#flag"`);
  assertStringIncludes(await Ende.readTextFile(join(dest, "old", "index.html")), `<link rel="canonical" href="https://example.com/x">`);
  assertEquals(pages.map(page => page.url), ["/a/"]);
});

Ende.test("build() rejects a redirect that clashes with a page or doesn't start with /", async () => {
  const src = await writeSite({ "a.md": "a\n" });
  await assertRejects(
    () => build({ src, dest: join(src, "_site"), redirects: { "/a/": "/b/" } }),
    Error,
    "a.md and the redirect from /a/ both write /a/index.html"
  );
  await assertRejects(() => build({ src, dest: join(src, "_site"), redirects: { "a/": "/b/" } }), Error, `redirect from "a/" must start with /`);
});

Ende.test("build() resolves relative links and images in Markdown against the source file", async () => {
  const { read } = await buildSite({
    "guide/tutorials/a.md": "---\nurl: /a-tutorial/\n---\n![Shot](./images/shot.png) [Up](../other/?x=1#y) [Same](#z)\n",
    "guide/tutorials/images/shot.png": "png"
  });

  assertEquals(
    await read("a-tutorial/index.html"),
    `<p><img src="/guide/tutorials/images/shot.png" alt="Shot" /> <a href="/guide/other/?x=1#y">Up</a> <a href="#z">Same</a></p>\n`
  );
});
