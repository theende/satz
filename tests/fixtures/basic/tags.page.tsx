// Copyright 2026 the Ende authors. MIT license.
export const layout = "base.tsx";

export default function*() {
  for (const tag of ["a", "b"]) {
    yield { url: `/tags/${tag}/`, title: `Tag ${tag}`, content: <p>{tag}</p> };
  }
}
