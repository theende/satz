// Copyright 2026 the Ende authors. MIT license.
/**
 * A JSX runtime that renders to HTML strings, for the compiler's `precompile`
 * JSX mode:
 *
 * ```json
 * { "compilerOptions": { "jsx": "precompile", "jsxImportSource": "@ende/satz" } }
 * ```
 *
 * The compiler turns static markup into escaped HTML strings and calls
 * `jsxTemplate()` with them, passing dynamic attributes through `jsxAttr()` and
 * dynamic children through `jsxEscape()`. Components, and elements it can't
 * precompile (spread props), go through `jsx()`. Use {@linkcode raw} for trusted
 * HTML children.
 * Nothing renders until {@linkcode renderToString}, which awaits async
 * components and promise children along the way.
 *
 * @module
 */
import { escape } from "@ende/html";

// A registered symbol, so raw HTML from another copy of this module (a site
// whose `@ende/satz/jsx-runtime` resolves to a different satz version than the
// CLI) is still recognized.
const RAW_HTML = Symbol.for("@ende/satz/raw-html");

/** Trusted HTML that is inserted without escaping. Create it with {@linkcode raw}. */
export class RawHtml {
  /** The HTML. */
  readonly html: string;
  /** Brands the value as raw HTML. */
  readonly [RAW_HTML] = true;
  constructor(html: string) {
    this.html = html;
  }
}

function isRawHtml(value: unknown): value is RawHtml {
  return typeof value === "object" && value !== null && RAW_HTML in value;
}

/** Marks `html` as trusted, so it renders unescaped. */
export function raw(html: string): RawHtml {
  return new RawHtml(html);
}

/**
 * Anything that can appear as a JSX child. A promise must resolve to a
 * `Child`; it is typed `Promise<unknown>` because tsc rejects awaiting a
 * promise type that refers to itself.
 */
export type Child = VNode | RawHtml | string | number | bigint | boolean | null | undefined | Promise<unknown> | readonly Child[];

/** A function component. It may be async. */
// deno-lint-ignore no-explicit-any
export type Component<P = any> = (props: P) => Child;

/** An element recorded by `jsx()`, rendered later by {@linkcode renderToString}. */
export interface VNode {
  /** The element's props, including `children`. */
  props: Record<string, unknown>;
  /** A tag name or a component. */
  type: string | Component;
}

/** Groups children without a wrapper element. */
export function Fragment(props: { children?: Child; }): Child {
  return props.children;
}

/** Creates an element. Called by the compiled JSX. */
export function jsx(type: string | Component, props: Record<string, unknown>): VNode {
  return { props, type };
}

/**
 * Static HTML with its dynamic parts in between, created by precompiled JSX.
 * `exprs[i]` goes between `templates[i]` and `templates[i + 1]`. A string expr
 * is already escaped (it comes from `jsxAttr()` or `jsxEscape()`); anything
 * else is rendered.
 */
export function jsxTemplate(templates: readonly string[], ...exprs: unknown[]): VNode {
  return { props: { exprs, templates }, type: Template };
}

async function Template({ exprs, templates }: { exprs: unknown[]; templates: readonly string[]; }): Promise<RawHtml> {
  const parts = await Promise.all(exprs.map(expr => typeof expr === "string" || expr === NO_ATTR ? expr : renderToString(expr as Child)));
  let html = templates[0] ?? "";

  parts.forEach((part, i) => {
    // The template has a space before every dynamic attribute; drop it with
    // the attribute.
    html = part === NO_ATTR ? html.replace(/ $/, "") : html + part;
    html += templates[i + 1] ?? "";
  });

  return raw(html);
}

// What jsxAttr() returns for an attribute that is left out. Registered, like
// RAW_HTML, so another copy of this module recognizes it.
const NO_ATTR = Symbol.for("@ende/satz/no-attr");

/**
 * Renders a dynamic attribute of precompiled JSX, without a leading space. An
 * attribute that is left out (false, nullish, `key`) returns a marker that
 * tells `jsxTemplate()` to drop the space before it too.
 */
export function jsxAttr(name: string, value: unknown): string | symbol {
  const attr = name === "key" ? "" : renderAttribute(name, value, "an element");
  return attr === "" ? NO_ATTR : attr.slice(1);
}

/**
 * Escapes a dynamic child of precompiled JSX. Strings and numbers become
 * escaped HTML, booleans and nullish values become nothing, and elements,
 * arrays and promises are passed on to be rendered.
 */
export function jsxEscape(value: unknown): unknown {
  if (value === null || value === undefined || typeof value === "boolean")
    return "";

  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint")
    return escape(String(value));

  if (typeof value === "function")
    throw new Error("Cannot render a function as a JSX child: satz renders static HTML");

  return value;
}

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** Renders a JSX child (an element, a string, an array, ...) to HTML. */
export async function renderToString(child: Child): Promise<string> {
  if (child === null || child === undefined || typeof child === "boolean")
    return "";

  if (typeof child === "string" || typeof child === "number" || typeof child === "bigint")
    return escape(String(child));

  if (isRawHtml(child))
    return child.html;

  if (child instanceof Promise)
    return renderToString((await child) as Child);

  if (Array.isArray(child))
    return (await Promise.all(child.map(renderToString))).join("");

  const { props, type } = child as VNode;

  if (typeof type === "function")
    return renderToString(type(props));

  return renderElement(type, props);
}

async function renderElement(tag: string, props: Record<string, unknown>): Promise<string> {
  let attrs = "";

  for (const [name, value] of Object.entries(props)) {
    if (name === "children" || name === "key")
      continue;

    attrs += renderAttribute(name, value, `<${tag}>`);
  }

  const children = await renderToString(props.children as Child);

  if (VOID_ELEMENTS.has(tag)) {
    if (children !== "")
      throw new Error(`<${tag}> is a void element and cannot have children`);

    return `<${tag}${attrs}>`;
  }

  return `<${tag}${attrs}>${children}</${tag}>`;
}

function renderAttribute(name: string, value: unknown, element: string): string {
  if (value === null || value === undefined || value === false)
    return "";

  if (typeof value === "function")
    throw new Error(`Cannot render the function attribute ${name} on ${element}: satz renders static HTML`);

  const attr = name === "className" ? "class" : name;

  if (value === true)
    return ` ${attr}`;

  if (attr === "style" && typeof value === "object")
    return ` style="${escape(renderStyle(value as Record<string, unknown>))}"`;

  if (typeof value === "object")
    throw new Error(`Cannot render the object attribute ${name} on ${element}`);

  return ` ${attr}="${escape(String(value))}"`;
}

function renderStyle(style: Record<string, unknown>): string {
  return Object
    .entries(style)
    .filter(([, value]) => value !== null && value !== undefined && value !== false)
    .map(([prop, value]) => `${prop.startsWith("--") ? prop : prop.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}:${value}`)
    .join(";");
}

/** Types for TSX that uses this runtime. */
export declare namespace JSX {
  /** What a JSX expression evaluates to. */
  export type Element = VNode;
  /** What may be used as a tag: any element name or a component. */
  export type ElementType = string | Component;
  /** Every element accepts any attribute. */
  export interface IntrinsicElements {
    [name: string]: Record<string, unknown>;
  }
  /** Props every element and component accepts. `key` is ignored when rendering. */
  export interface IntrinsicAttributes {
    key?: unknown;
  }
  /** The prop that holds an element's children. */
  export interface ElementChildrenAttribute {
    children: unknown;
  }
}
