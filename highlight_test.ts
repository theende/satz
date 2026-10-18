// Copyright 2026 the Ende authors. MIT license.
import { assert, assertEquals } from "@ende/assert";
import { unescape } from "@ende/html";
import { fromFileUrl } from "@ende/path";
import { highlight } from "./highlight.ts";

/** Removes the highlighting markup, giving back the code. */
function plain(html: string): string {
  return unescape(html.replace(/<\/?span[^>]*>/g, ""));
}

Ende.test("highlight() returns undefined for a language it doesn't know", () => {
  assertEquals(highlight("x = 1", "hcl"), undefined);
  assertEquals(highlight("# Title", "markdown"), undefined);
  assertEquals(highlight("x", "nope"), undefined);
});

Ende.test("highlight() escapes plain text languages", () => {
  for (const lang of ["text", "txt", "plaintext"])
    assertEquals(highlight("a <b> & c", lang), "a &lt;b&gt; &amp; c");
});

Ende.test("highlight() matches language names case-insensitively", () => {
  assertEquals(highlight("FROM x", "Dockerfile"), highlight("FROM x", "dockerfile"));
  assertEquals(highlight("let a", "TS"), highlight("let a", "ts"));
});

Ende.test("highlight() highlights TypeScript", () => {
  assertEquals(
    highlight(`const n: number = 1; // one`, "ts"),
    `<span class="hl-keyword">const</span> n<span class="hl-punctuation">:</span> <span class="hl-type">number</span> <span class="hl-operator">=</span> <span class="hl-number">1</span><span class="hl-punctuation">;</span> <span class="hl-comment">// one</span>`
  );
  assertEquals(
    highlight(`Ende.serve(() => new Response("hi"));`, "typescript"),
    `<span class="hl-builtin">Ende</span><span class="hl-punctuation">.</span><span class="hl-function">serve</span><span class="hl-punctuation">(</span><span class="hl-punctuation">(</span><span class="hl-punctuation">)</span> <span class="hl-operator">=&gt;</span> <span class="hl-keyword">new</span> <span class="hl-function">Response</span><span class="hl-punctuation">(</span><span class="hl-string">&quot;hi&quot;</span><span class="hl-punctuation">)</span><span class="hl-punctuation">)</span><span class="hl-punctuation">;</span>`
  );
});

Ende.test("highlight() treats a / after a value as division and elsewhere as a regex", () => {
  assertEquals(highlight("a / b / c", "js"), `a <span class="hl-operator">/</span> b <span class="hl-operator">/</span> c`);
  assertEquals(
    highlight("x = /a\\/b/g", "js"),
    `x <span class="hl-operator">=</span> <span class="hl-regex">/a\\/b/g</span>`
  );
});

Ende.test("highlight() highlights the expressions inside template literals", () => {
  assertEquals(
    highlight("`a ${b + 1} c`", "js"),
    `<span class="hl-string">\`a </span><span class="hl-punctuation">\${</span>b <span class="hl-operator">+</span> <span class="hl-number">1</span><span class="hl-punctuation">}</span><span class="hl-string"> c\`</span>`
  );
});

Ende.test("highlight() highlights JSX in tsx and jsx, keeping apostrophes in text plain", () => {
  assertEquals(
    highlight(`return <p class="x" n={1}>Don't {a}</p>;`, "tsx"),
    `<span class="hl-keyword">return</span> <span class="hl-tag">&lt;p</span> <span class="hl-attr">class</span><span class="hl-operator">=</span><span class="hl-string">&quot;x&quot;</span> <span class="hl-attr">n</span><span class="hl-operator">=</span><span class="hl-punctuation">{</span><span class="hl-number">1</span><span class="hl-punctuation">}</span><span class="hl-tag">&gt;</span>Don&#39;t <span class="hl-punctuation">{</span>a<span class="hl-punctuation">}</span><span class="hl-tag">&lt;/p&gt;</span><span class="hl-punctuation">;</span>`
  );
  // In plain TypeScript, < is a comparison or a type argument.
  assertEquals(highlight("a < b", "ts"), `a <span class="hl-operator">&lt;</span> b`);
  assertEquals(
    highlight("f<T>(c)", "ts"),
    `<span class="hl-function">f</span><span class="hl-operator">&lt;</span>T<span class="hl-operator">&gt;</span><span class="hl-punctuation">(</span>c<span class="hl-punctuation">)</span>`
  );
});

Ende.test("highlight() highlights shell commands", () => {
  assertEquals(
    highlight(`ende run --allow-net "$HOME/a.ts" # go`, "sh"),
    `<span class="hl-function">ende</span> run <span class="hl-attr">--allow-net</span> <span class="hl-string">&quot;$HOME/a.ts&quot;</span> <span class="hl-comment"># go</span>`
  );
  assertEquals(
    highlight(`export X=1 && echo $X | grep 1`, "bash"),
    `<span class="hl-keyword">export</span> X=1 <span class="hl-operator">&amp;&amp;</span> <span class="hl-function">echo</span> <span class="hl-variable">$X</span> <span class="hl-operator">|</span> <span class="hl-function">grep</span> 1`
  );
  assertEquals(
    highlight("curl -fsSL https://ende.sh/install.sh#x", "shell"),
    `<span class="hl-function">curl</span> <span class="hl-attr">-fsSL</span> https://ende.sh/install.sh#x`
  );
});

Ende.test("highlight() highlights console prompts and leaves output plain", () => {
  assertEquals(
    highlight("$ ende --version\nende 2026.10.17\n> 1 + 1\n2", "console"),
    `<span class="hl-prompt">$</span> <span class="hl-function">ende</span> <span class="hl-attr">--version</span>\nende 2026.10.17\n<span class="hl-prompt">&gt;</span> 1 + 1\n2`
  );
  assertEquals(
    highlight("$ ende run \\\n  -A a.ts\nok", "shellsession"),
    `<span class="hl-prompt">$</span> <span class="hl-function">ende</span> run \\\n  <span class="hl-attr">-A</span> a.ts\nok`
  );
});

Ende.test("highlight() tells JSON keys from values", () => {
  assertEquals(
    highlight(`{ "a": "b", "n": -1.5, "t": true } // c`, "jsonc"),
    `<span class="hl-punctuation">{</span> <span class="hl-property">&quot;a&quot;</span><span class="hl-punctuation">:</span> <span class="hl-string">&quot;b&quot;</span><span class="hl-punctuation">,</span> <span class="hl-property">&quot;n&quot;</span><span class="hl-punctuation">:</span> <span class="hl-number">-1.5</span><span class="hl-punctuation">,</span> <span class="hl-property">&quot;t&quot;</span><span class="hl-punctuation">:</span> <span class="hl-builtin">true</span> <span class="hl-punctuation">}</span> <span class="hl-comment">// c</span>`
  );
});

Ende.test("highlight() marks inserted and deleted diff lines", () => {
  assertEquals(
    highlight("@@ -1 +1 @@\n-old\n+new\n same", "diff"),
    `<span class="hl-comment">@@ -1 +1 @@</span>\n<span class="hl-deleted">-old</span>\n<span class="hl-inserted">+new</span>\n same`
  );
});

Ende.test("highlight() highlights Python", () => {
  assertEquals(
    highlight(`def f(x):\n    return "a" if x else None  # n`, "py"),
    `<span class="hl-keyword">def</span> <span class="hl-function">f</span><span class="hl-punctuation">(</span>x<span class="hl-punctuation">)</span><span class="hl-punctuation">:</span>\n    <span class="hl-keyword">return</span> <span class="hl-string">&quot;a&quot;</span> <span class="hl-keyword">if</span> x <span class="hl-keyword">else</span> <span class="hl-builtin">None</span>  <span class="hl-comment"># n</span>`
  );
});

Ende.test("highlight() highlights YAML keys, values and comments", () => {
  assertEquals(
    highlight(`on:\n  - push # c\nname: "CI"\nn: 2`, "yml"),
    `<span class="hl-property">on</span><span class="hl-punctuation">:</span>\n  <span class="hl-punctuation">-</span> push <span class="hl-comment"># c</span>\n<span class="hl-property">name</span><span class="hl-punctuation">:</span> <span class="hl-string">&quot;CI&quot;</span>\n<span class="hl-property">n</span><span class="hl-punctuation">:</span> <span class="hl-number">2</span>`
  );
});

Ende.test("highlight() highlights HTML tags, attributes and comments", () => {
  assertEquals(
    highlight(`<!-- c --><a href="/x" hidden>Hi &amp; bye</a>`, "html"),
    `<span class="hl-comment">&lt;!-- c --&gt;</span><span class="hl-tag">&lt;a</span> <span class="hl-attr">href</span><span class="hl-operator">=</span><span class="hl-string">&quot;/x&quot;</span> <span class="hl-attr">hidden</span><span class="hl-tag">&gt;</span>Hi <span class="hl-builtin">&amp;amp;</span> bye<span class="hl-tag">&lt;/a&gt;</span>`
  );
});

Ende.test("highlight() highlights Dockerfile instructions", () => {
  assertEquals(
    highlight(`# base\nFROM ende:latest AS build\nCOPY --chown=ende . $APP`, "dockerfile"),
    `<span class="hl-comment"># base</span>\n<span class="hl-keyword">FROM</span> ende:latest <span class="hl-keyword">AS</span> build\n<span class="hl-keyword">COPY</span> <span class="hl-attr">--chown=ende</span> . <span class="hl-variable">$APP</span>`
  );
});

Ende.test("highlight() highlights INI and TOML", () => {
  assertEquals(
    highlight(`; c\n[section]\n@jsr:registry=https://npm.jsr.io`, "ini"),
    `<span class="hl-comment">; c</span>\n<span class="hl-keyword">[section]</span>\n<span class="hl-property">@jsr:registry</span><span class="hl-operator">=</span>https://npm.jsr.io`
  );
  assertEquals(
    highlight(`[a.b]\nx = "y" # c\nn = 3\nok = true`, "toml"),
    `<span class="hl-keyword">[a.b]</span>\n<span class="hl-property">x</span> <span class="hl-operator">=</span> <span class="hl-string">&quot;y&quot;</span> <span class="hl-comment"># c</span>\n<span class="hl-property">n</span> <span class="hl-operator">=</span> <span class="hl-number">3</span>\n<span class="hl-property">ok</span> <span class="hl-operator">=</span> <span class="hl-builtin">true</span>`
  );
});

Ende.test("highlight() highlights Rust", () => {
  assertEquals(
    highlight(`#[no_mangle]\npub fn add(a: i32) -> i32 { println!("{}", 'c'); a }`, "rs"),
    `<span class="hl-attr">#[no_mangle]</span>\n<span class="hl-keyword">pub</span> <span class="hl-keyword">fn</span> <span class="hl-function">add</span><span class="hl-punctuation">(</span>a<span class="hl-punctuation">:</span> <span class="hl-type">i32</span><span class="hl-punctuation">)</span> <span class="hl-operator">-&gt;</span> <span class="hl-type">i32</span> <span class="hl-punctuation">{</span> <span class="hl-function">println!</span><span class="hl-punctuation">(</span><span class="hl-string">&quot;{}&quot;</span><span class="hl-punctuation">,</span> <span class="hl-string">&#39;c&#39;</span><span class="hl-punctuation">)</span><span class="hl-punctuation">;</span> a <span class="hl-punctuation">}</span>`
  );
});

Ende.test("highlight() keeps every character of real docs snippets, in order", async () => {
  const dir = fromFileUrl(new URL("./tests/fixtures/highlight/", import.meta.url));

  for await (const entry of Ende.readDir(dir)) {
    const lang = entry.name.replace(/\.txt$/, "");
    const code = await Ende.readTextFile(`${dir}/${entry.name}`);
    const html = highlight(code, lang);

    assert(html !== undefined, `${lang} is not supported`);
    assertEquals(plain(html), code, `${lang} lost or changed characters`);
    assert(html.includes(`<span class="hl-`), `${lang} highlighted nothing`);
  }
});

Ende.test("highlight() keeps unterminated strings, comments and templates", () => {
  for (const [code, lang] of [["\"abc", "ts"], ["/* x", "js"], ["`a ${b", "ts"], ["<p {x", "tsx"], ["'x", "sh"], ["\"\"\"doc", "py"], ["<a href=\"x", "html"]])
    assertEquals(plain(highlight(code!, lang!)!), code);
});
