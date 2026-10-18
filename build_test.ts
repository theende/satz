// Copyright 2026 the Ende authors. MIT license.
import { assertEquals, assertRejects } from "@ende/assert";
import { walk } from "@ende/fs/walk";
import { join, relative } from "@ende/path";
import { build } from "./build.ts";

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
