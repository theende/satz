# satz

satz is a static site generator for [Ende](https://ende.sh), built on the
`@ende/*` standard library. It renders Markdown pages and `.page.tsx` modules
through TSX layouts into plain HTML, with no npm packages and no bundler.

## Use

```sh
ende run -A jsr:@ende/satz/cli build [--src <dir>] [--dest <dir>]
ende run -A jsr:@ende/satz/cli serve [--src <dir>] [--dest <dir>] [--port <port>]
```

Or install it as a `satz` command:

```sh
ende install -g -A -n satz jsr:@ende/satz/cli
```

`build` writes the site once (to `_site` in `src` by default). `serve` builds
it, serves it, and rebuilds and reloads open pages when a file changes. A failed
build keeps the last good one served and shows the error in the browser.

`build()` and `serve()` are also exported from `@ende/satz` for scripts.

## A site

```
_config.ts          optional, see below
_data.yaml          data for every page below this directory
_includes/base.tsx  a layout
index.md            → /
guide/intro.md      → /guide/intro/
tags.page.tsx       one page, or a generator yielding many
js/main.ts          → /js/main.js, a browser script
static/logo.svg     copied as is
```

`_config.ts` default-exports any of:

| Option     | Meaning                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `dest`     | where the site is written, relative to `src` (default `_site`)          |
| `data`     | data every page receives, below the `_data` files                       |
| `location` | the site's absolute URL (`https://docs.ende.sh`): writes `/sitemap.xml` |
| `search`   | `true` writes `/search.json` and `/_satz/search.js`                     |

The command-line flags win over `_config.ts`.

- **Pages.** Markdown takes YAML front matter. A `.page.tsx` module's named
  exports are its data; its default export renders the page, or, as a
  generator, yields pages that each have a `url`.
- **URLs** come from the path, or from `url` in the page's data. They end with
  `/` (written as `index.html`) or a file extension (`/404.html`,
  `/feed.xml`). Two sources writing the same file fail the build.
- **Data.** `_data.json`, `_data.yaml`, `_data.yml` and `_data.ts` merge into
  the data of every page below them; front matter and page exports win.
- **Layouts.** `layout: base.tsx` renders the page through
  `_includes/base.tsx`, which gets the page's data plus `content`, and may
  `export const layout = "…"` to wrap itself in another layout.
- **Skipped.** Names starting with `_` or `.` are not output.
- **Markdown** is GitHub-flavored, alerts (`> [!NOTE]`) included. Relative
  links to `.md` files become page URLs, and a broken one fails the build.
  Pages get `toc` (their headings) and, without a `title`, the first `#`
  heading as `title`.
- **Code blocks** are highlighted with `hl-*` classes (see
  `@ende/satz/highlight` for the classes and languages). A fence like
  `` ```json title="ende.json" `` is wrapped in a
  `<figure class="code-block">` with a `<figcaption>`.
- **Redirects.** `oldUrl` (a path or a list) writes a redirect page at each old
  URL, which works on any static host; `serve` answers old URLs with a 301.
- **Sitemap.** With `location`, `/sitemap.xml` lists every HTML page except
  `/404.html`, redirect pages and pages with `sitemap: false`, with
  `<lastmod>` from `last_modified`.
- **Browser scripts.** Other `.ts` and `.tsx` files are written as `.js` by
  `ende transpile`: types stripped, not type-checked, not bundled. Relative
  imports of `.ts` files point at the `.js`. `.d.ts` files are skipped. CSS and
  everything else is copied as is.

## JSX

Layouts and `.page.tsx` modules use satz's JSX runtime, which renders to HTML
strings. In the site's `ende.json`:

```json
{ "compilerOptions": { "jsx": "precompile", "jsxImportSource": "@ende/satz" } }
```

Text and attributes are escaped; `raw(html)` from `@ende/satz/jsx-runtime`
inserts trusted HTML. Components may be async.

## Search

With `search: true`, `/search.json` lists the sitemap's pages (minus
`search: false`): URL, title, description, headings, and the first ~2000
characters of text without code blocks. `/_satz/search.js` is
`@ende/satz/search` as JavaScript, for the site's own browser script:

```js
import { search } from "/_satz/search.js";

const entries = await (await fetch("/search.json")).json();
const results = search(entries, "serve fi"); // [{ url: "/serve/#serve-files", entry, heading, score }, …]
```

## Limits

- No bundling: browser scripts can import each other and URLs, not packages.
- `ende transpile` is experimental. satz rewrites relative `.ts` imports in its
  output itself, on the text, so a string that looks like such an import is
  rewritten too.
- Right after a new `@ende/*` release, Ende's 24-hour minimum dependency age
  can block `ende run jsr:@ende/satz/cli` until the new versions are a day old
  (or pass `--min-dep-age=0`).

## Development

```sh
ende task ok    # fmt, lint, check, test
ende task gen   # after changing search.ts: regenerates _search_client.ts
```

`ende.lock` is committed, and CI installs with `ende install --frozen`. See
[RELEASE.md](RELEASE.md) for releasing.
