# satz

satz is a static site generator for [Ende](https://ende.sh), built on the
`@ende/*` standard library. It renders Markdown pages and `.page.tsx` modules
through TSX layouts into plain HTML, with no npm packages.

```sh
ende run -A jsr:@ende/satz/cli build --src docs --dest _site
ende run -A jsr:@ende/satz/cli serve --src docs --port 3000
```

`serve` builds the site, serves it, and rebuilds and reloads open pages when a
file changes. A failed build keeps the last good one served and shows the error
in the browser.

## A site

```
_config.ts          optional: export default { dest, data, location, search }
_data.yaml          data for every page below this directory
_includes/base.tsx  a layout
index.md            → /
guide/intro.md      → /guide/intro/
tags.page.tsx       one page, or a generator yielding many
js/main.ts          → /js/main.js, a browser script
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
- Markdown pages get `toc` (their headings) and, without a `title` in front
  matter, the first `#` heading as `title`. Code blocks are highlighted with
  `hl-*` classes (`@ende/satz/highlight`); a fence like
  `` ```json title="ende.json" `` gets a `<figcaption>`.
- `oldUrl` (a path or a list) writes a redirect page at each old URL, which
  works on any static host; `serve` answers old URLs with a 301.
- With a `location` (`https://docs.ende.sh`), the build writes `/sitemap.xml`
  with every HTML page except `/404.html` and pages with `sitemap: false`, and
  `<lastmod>` from `last_modified`.
- Other `.ts` and `.tsx` files are browser scripts, written as `.js` by
  `ende transpile` (types stripped, not type-checked; there's no bundling).
  Relative imports of `.ts` files point at the `.js`. `.d.ts` files are
  skipped. CSS and everything else is copied as is.
- With `search: true`, the build writes `/search.json` (the pages in the
  sitemap's sense, minus `search: false`: URL, title, description, headings and
  the first ~2000 characters of text without code blocks) and
  `/_satz/search.js`, the `@ende/satz/search` module as JavaScript. A browser
  script ranks the index with it:

  ```ts
  import { search, type SearchEntry } from "/_satz/search.js";

  const entries: SearchEntry[] = await (await fetch("/search.json")).json();
  const results = search(entries, "serve fi"); // [{ url: "/serve/#serve-files", entry, heading, score }, …]
  ```

Layouts and pages use satz's JSX runtime, which renders to strings:

```json
{ "compilerOptions": { "jsx": "precompile", "jsxImportSource": "@ende/satz" } }
```

## Development

```sh
ende task ok   # fmt, lint, check, test
```
