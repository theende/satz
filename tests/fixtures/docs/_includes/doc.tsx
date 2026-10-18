// Copyright 2026 the Ende authors. MIT license.
import type { Child } from "@ende/satz/jsx-runtime";
import type { TocEntry } from "@ende/markdown/types";

export default ({ title, toc, content }: { title: string; toc: TocEntry[]; content: Child; }) => (
  <html lang="en">
    <head>
      <title>{title}</title>
    </head>
    <body>
      <nav>
        {toc.filter(entry => entry.depth === 2).map(entry => <a href={`#${entry.slug}`}>{entry.text}</a>)}
      </nav>
      <article>
        <h1>{title}</h1>
        {content}
      </article>
    </body>
  </html>
);
