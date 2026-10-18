// Copyright 2026 the Ende authors. MIT license.
import type { Child } from "@ende/satz/jsx-runtime";

export const layout = "base.tsx";

export default ({ title, section, content }: { title: string; section: string; content: Child; }) => (
  <main data-section={section}>
    <h1>{title}</h1>
    {content}
  </main>
);
