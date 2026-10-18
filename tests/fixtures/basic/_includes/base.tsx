// Copyright 2026 the Ende authors. MIT license.
import type { Child } from "@ende/satz/jsx-runtime";

export default ({ title, site, content }: { title: string; site: string; content: Child; }) => (
  <html>
    <head>
      <title>
        {title} | {site}
      </title>
    </head>
    <body>{content}</body>
  </html>
);
