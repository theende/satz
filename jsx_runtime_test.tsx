// Copyright 2026 the Ende authors. MIT license.
import { assertEquals, assertRejects } from "@ende/assert";
import { jsx, jsxAttr, jsxEscape, jsxTemplate, raw, renderToString, type Child } from "./jsx_runtime.ts";

Ende.test("renderToString() escapes text and attribute values", async () => {
  assertEquals(
    await renderToString(<p title={`"a" & 'b'`}>{"<script>&"}</p>),
    `<p title="&quot;a&quot; &amp; &#39;b&#39;">&lt;script&gt;&amp;</p>`
  );
});

Ende.test("renderToString() writes void elements without a closing tag", async () => {
  assertEquals(
    await renderToString(
      <div>
        <br />
        <img src="a.png" alt="" />
      </div>
    ),
    `<div><br><img src="a.png" alt=""></div>`
  );
});

Ende.test("renderToString() rejects children on a void element", async () => {
  // Precompiled JSX drops them at compile time; elements built by jsx() (spread props) still get here.
  await assertRejects(() => renderToString(jsx("br", { children: "x" })), Error, "<br> is a void element");
});

Ende.test("renderToString() writes true attributes bare and drops false, null and undefined", async () => {
  assertEquals(
    await renderToString(<input disabled checked={false} value={undefined} name={null} />),
    `<input disabled>`
  );
});

Ende.test("renderToString() writes class and className as class", async () => {
  assertEquals(await renderToString(<a class="x" />), `<a class="x"></a>`);
  assertEquals(await renderToString(<a className="y" />), `<a class="y"></a>`);
});

Ende.test("renderToString() turns a style object into CSS", async () => {
  assertEquals(
    await renderToString(<p style={{ marginTop: "1px", "--gap": 2, color: undefined }} />),
    `<p style="margin-top:1px;--gap:2"></p>`
  );
});

Ende.test("renderToString() rejects function attributes", async () => {
  await assertRejects(async () => await renderToString(<button type="button" onClick={() => {}} />), Error, "onclick");
});

Ende.test("renderToString() flattens fragments and arrays and skips booleans and nullish children", async () => {
  assertEquals(
    await renderToString(
      <>
        {["a", 1, null, undefined, true, false]}
        <>
          <i>b</i>
        </>
      </>
    ),
    "a1<i>b</i>"
  );
});

Ende.test("renderToString() renders nested and async components", async () => {
  const Item = ({ children }: { children?: Child; }) => <li>{children}</li>;
  const List = async ({ items }: { items: string[]; }) => {
    await Promise.resolve();
    return <ul>{items.map(i => <Item key={i}>{i}</Item>)}</ul>;
  };
  assertEquals(await renderToString(<List items={["x", "y"]} />), "<ul><li>x</li><li>y</li></ul>");
});

Ende.test("renderToString() awaits promise children", async () => {
  assertEquals(await renderToString(<p>{Promise.resolve("later")}</p>), "<p>later</p>");
});

Ende.test("renderToString() inserts raw() unescaped", async () => {
  assertEquals(await renderToString(<div>{raw("<b>2</b>")}</div>), "<div><b>2</b></div>");
});

Ende.test("renderToString() rejects object attributes other than style", async () => {
  await assertRejects(async () => await renderToString(<div data-x={{ a: 1 }} />), Error, "object attribute data-x on an element");
  await assertRejects(
    async () => await renderToString(<div dangerouslySetInnerHTML={{ __html: "<b>1</b>" }} />),
    Error,
    "object attribute dangerouslySetInnerHTML on <div>"
  );
});

Ende.test("renderToString() recognizes raw HTML from another copy of the runtime", async () => {
  const fromOtherCopy = { html: "<b>3</b>", [Symbol.for("@ende/satz/raw-html")]: true };
  assertEquals(await renderToString(<div>{fromOtherCopy as unknown as Child}</div>), "<div><b>3</b></div>");
});

Ende.test("renderToString() renders a plain string", async () => {
  assertEquals(await renderToString("a<b"), "a&lt;b");
});

Ende.test("jsxAttr() writes an escaped attribute, bare when true, nothing when false or nullish", () => {
  assertEquals(jsxAttr("title", `"a" & b`), `title="&quot;a&quot; &amp; b"`);
  assertEquals(jsxAttr("hidden", true), "hidden");
  assertEquals(jsxAttr("style", { marginTop: 0 }), `style="margin-top:0"`);
});

Ende.test("jsxAttr() leaves out false and nullish attributes and key, with the space before them", async () => {
  const template = jsxTemplate(["<input ", " ", " ", " ", ">"], jsxAttr("hidden", false), jsxAttr("name", null), jsxAttr("key", "k"), jsxAttr("id", "x"));
  assertEquals(await renderToString(template), `<input id="x">`);
});

Ende.test("jsxEscape() escapes primitives, drops booleans and nullish values, and passes elements through", () => {
  assertEquals(jsxEscape("<a>"), "&lt;a&gt;");
  assertEquals(jsxEscape(1), "1");
  assertEquals(jsxEscape(false), "");
  assertEquals(jsxEscape(undefined), "");
  const node = <i>x</i>;
  assertEquals(jsxEscape(node), node);
});

Ende.test("jsxTemplate() fills static HTML with rendered dynamic parts in order", async () => {
  const Slow = async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return <b>slow</b>;
  };
  const template = jsxTemplate(["<p ", ">", "|", "|", "</p>"], jsxAttr("id", "a&b"), jsxEscape("<x>"), <Slow />, jsxEscape(["<y>", 2]));
  assertEquals(await renderToString(template), `<p id="a&amp;b">&lt;x&gt;|<b>slow</b>|&lt;y&gt;2</p>`);
});

Ende.test("renderToString() renders elements with spread props, which precompile leaves to jsx()", async () => {
  const props = { id: "q", "data-x": "<1>" };
  assertEquals(await renderToString(<p {...props}>spread</p>), `<p id="q" data-x="&lt;1&gt;">spread</p>`);
});
