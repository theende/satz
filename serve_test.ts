// Copyright 2026 the Ende authors. MIT license.
import { assert, assertEquals, assertStringIncludes } from "@ende/assert";
import { join } from "@ende/path";
import { serve, type BuildReport, type SiteServer } from "./serve.ts";

const SITE = {
  "index.md": "# Home\n",
  "guide.md": "---\noldUrl:\n  - /old-guide\n  - /older/guide.html\n---\n# Guide\n",
  "404.md": "---\nurl: /404.html\n---\nNothing here.\n",
  "full.page.ts": `export default () => "<html><body><p>full</p></body></html>";\n`,
  "robots.txt": "User-agent: *\n",
  "_config.ts": `export default { redirects: { "/go/guide/": "/guide/#guide" } };\n`
};

async function writeSite(files: Record<string, string>): Promise<string> {
  const src = await Ende.makeTempDir();

  for (const [path, text] of Object.entries(files)) {
    await Ende.mkdir(join(src, path, ".."), { recursive: true });
    await Ende.writeTextFile(join(src, path), text);
  }

  return src;
}

/** Starts a server on a free port and collects its build reports. */
async function start(src: string): Promise<{ server: SiteServer; nextBuild: () => Promise<BuildReport>; }> {
  const reports: BuildReport[] = [];
  let waiting: ((report: BuildReport) => void) | undefined;

  const server = await serve({
    src,
    port: 0,
    hostname: "127.0.0.1",
    onBuild: report => {
      if (waiting === undefined) {
        reports.push(report);
        return;
      }

      waiting(report);
      waiting = undefined;
    }
  });

  assertEquals(reports.shift()?.ok, true);

  const nextBuild = () => {
    const report = reports.shift();

    if (report !== undefined)
      return Promise.resolve(report);

    return new Promise<BuildReport>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no rebuild within 5 s")), 5000);

      waiting = report => {
        clearTimeout(timer);
        resolve(report);
      };
    });
  };

  return { server, nextBuild };
}

/** Reads server-sent events until one named `name` arrives, returning its data. */
async function nextEvent(reader: ReadableStreamDefaultReader<string>, name: string): Promise<string> {
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done)
      throw new Error(`the event stream ended before a ${name} event`);

    buffer += value;
    let end;

    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const message = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const lines = message.split("\n");

      if (lines.includes(`event: ${name}`))
        return lines.filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
    }
  }
}

Ende.test("serve() serves the built site with the reload script in HTML only", async () => {
  const { server } = await start(await writeSite(SITE));

  try {
    const home = await fetch(`${server.url}/`);
    const html = await home.text();
    assertEquals(home.status, 200);
    assertStringIncludes(html, "<h1 id=\"home\">Home</h1>");
    assertStringIncludes(html, `new EventSource("/_satz/reload")`);

    const full = await (await fetch(`${server.url}/full/`)).text();
    assert(/<p>full<\/p><script>[\s\S]*<\/script><\/body><\/html>$/.test(full), full);

    const robots = await fetch(`${server.url}/robots.txt`);
    assertEquals(await robots.text(), "User-agent: *\n");
  } finally {
    await server.close();
  }
});

Ende.test("serve() answers a missing page with 404.html and an old URL with a 301", async () => {
  const { server } = await start(await writeSite(SITE));

  try {
    const missing = await fetch(`${server.url}/nope/`);
    assertEquals(missing.status, 404);
    assertStringIncludes(await missing.text(), "Nothing here.");

    for (const oldUrl of ["/old-guide", "/old-guide/", "/older/guide.html"]) {
      const moved = await fetch(`${server.url}${oldUrl}`, { redirect: "manual" });
      await moved.body?.cancel();
      assertEquals([moved.status, moved.headers.get("location")], [301, "/guide/"], oldUrl);
    }

    const go = await fetch(`${server.url}/go/guide/`, { redirect: "manual" });
    await go.body?.cancel();
    assertEquals([go.status, go.headers.get("location")], [301, "/guide/#guide"]);
  } finally {
    await server.close();
  }
});

Ende.test("serve() rebuilds on a change, tells the browser to reload, and keeps the last good build on an error", async () => {
  const src = await writeSite(SITE);
  const { server, nextBuild } = await start(src);
  const events = await fetch(`${server.url}/_satz/reload`);
  const reader = events.body!.pipeThrough(new TextDecoderStream()).getReader();

  try {
    await nextEvent(reader, "connected");

    await Ende.writeTextFile(join(src, "index.md"), "# Changed\n");
    assertEquals((await nextBuild()).ok, true);
    await nextEvent(reader, "reload");
    assertStringIncludes(await (await fetch(`${server.url}/`)).text(), "Changed");

    await Ende.writeTextFile(join(src, "index.md"), "[broken](missing.md)\n");
    const failed = await nextBuild();
    assertEquals(failed.ok, false);
    assertStringIncludes(failed.ok ? "" : failed.error, "index.md links to missing.md, which is not a page");
    assertStringIncludes(await nextEvent(reader, "build-error"), "index.md links to missing.md");
    assertStringIncludes(await (await fetch(`${server.url}/`)).text(), "Changed");
  } finally {
    await reader.cancel();
    await server.close();
  }
});

Ende.test("serve() re-imports the modules a page imports on every build", async () => {
  const src = await writeSite({
    "name.ts": `export const name = "one";\n`,
    "index.page.ts": `import { name } from "./name.ts";\nexport default () => name;\n`
  });
  const { server, nextBuild } = await start(src);

  try {
    assertStringIncludes(await (await fetch(`${server.url}/`)).text(), "one");

    await Ende.writeTextFile(join(src, "name.ts"), `export const name = "two";\n`);
    assertEquals((await nextBuild()).ok, true);
    assertStringIncludes(await (await fetch(`${server.url}/`)).text(), "two");
  } finally {
    await server.close();
  }
});

Ende.test("serve() serves browser scripts as JavaScript and rebuilds them on a change", async () => {
  const src = await writeSite({ "index.md": "# Home\n", "js/main.ts": "export const n: number = 1;\n" });
  const { server, nextBuild } = await start(src);

  try {
    const response = await fetch(`${server.url}/js/main.js`);
    assertEquals(response.status, 200);
    assertStringIncludes(response.headers.get("content-type") ?? "", "javascript");
    assertStringIncludes(await response.text(), "export const n = 1;");

    await Ende.writeTextFile(join(src, "js", "main.ts"), "export const n: number = 2;\n");
    assertEquals((await nextBuild()).ok, true);
    assertStringIncludes(await (await fetch(`${server.url}/js/main.js`)).text(), "export const n = 2;");
  } finally {
    await server.close();
  }
});
