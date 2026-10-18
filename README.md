# satz

satz is a static site generator for [Ende](https://ende.sh), built on the
`@ende/*` standard library. It renders Markdown pages and `.page.tsx` modules
through TSX layouts into plain HTML, with no npm packages.

```sh
ende run -A jsr:@ende/satz/cli build --src docs --dest _site
```

## A site

```
_config.ts          optional: export default { dest, data }
_data.yaml          data for every page below this directory
_includes/base.tsx  a layout
index.md            → /
guide/intro.md      → /guide/intro/
tags.page.tsx       one page, or a generator yielding many
static/logo.svg     copied as is
```

- Markdown pages take YAML front matter. `layout: base.tsx` renders the page
  through `_includes/base.tsx`, which may `export const layout = "…"` to wrap
  itself in another layout. Relative links to `.md` files become page URLs.
- `_data.json`, `_data.yaml`, `_data.yml` and `_data.ts` merge into the data of
  every page below them; front matter and page exports win.
- A page's URL comes from its path, or from `url` in its data. URLs end with
  `/` (written as `index.html`) or a file extension (`/404.html`).
- Names starting with `_` or `.` are not output.

Layouts and pages use satz's JSX runtime, which renders to strings:

```json
{ "compilerOptions": { "jsx": "precompile", "jsxImportSource": "@ende/satz" } }
```

## Development

```sh
ende task ok   # fmt, lint, check, test
```
