// Copyright 2026 the Ende authors. MIT license.
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@ende/assert";
import { walk } from "@ende/fs/walk";
import { join, relative } from "@ende/path";
import { build, type Page } from "./build.ts";

const FIXTURE = join(import.meta.dirname!, "tests", "fixtures", "basic");

async function buildFixture(): Promise<{ dest: string; read: (path: string) => Promise<string>; }> {
  const dest = await Ende.makeTempDir();
  await build({ src: FIXTURE, dest });
  return { dest, read: path => Ende.readTextFile(join(dest, path)) };
}

async function listFiles(dir: string): Promise<string[]> {
  const files = [];

  for await (const entry of walk(dir, { includeDirs: false })) {
    files.push(relative(dir, entry.path));
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

Ende.test("build() rejects two pages with the same URL", async () => {
  const src = await writeSite({ "a.md": "---\nurl: /x/\n---\n", "b.md": "---\nurl: /x/\n---\n" });
  await assertRejects(() => build({ src, dest: join(src, "_site") }), Error, "a.md and b.md both write /x/index.html");
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
