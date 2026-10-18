// Copyright 2026 the Ende authors. MIT license.
import { assertEquals } from "@ende/assert";
import { search, type SearchEntry } from "./search.ts";

const ENTRIES: SearchEntry[] = [
  { url: "/a/", title: "Basics", text: "You can fetch a resource with the fetch function." },
  { url: "/b/", title: "Fetch API", description: "Making requests" },
  {
    url: "/c/",
    title: "HTTP server",
    headings: [{ text: "Getting started", slug: "getting-started" }, { text: "Serve files", slug: "serve-files" }],
    text: "Ende serves HTTP with Ende.serve."
  },
  { url: "/d/", title: "Endless loops", text: "An endless serve loop." }
];

const urls = (query: string) => search(ENTRIES, query).map(result => result.url);

Ende.test("search() returns nothing for an empty query", () => {
  assertEquals(search(ENTRIES, ""), []);
  assertEquals(search(ENTRIES, "   "), []);
});

Ende.test("search() ranks a title match above a text match", () => {
  assertEquals(urls("fetch"), ["/b/", "/a/"]);
});

Ende.test("search() ignores case", () => {
  assertEquals(urls("FETCH"), ["/b/", "/a/"]);
});

Ende.test("search() matches the last word as a prefix and the others as whole words", () => {
  assertEquals(urls("ende serv"), ["/c/#serve-files"]);
  assertEquals(urls("endl"), ["/d/"]);
  assertEquals(urls("endl loop"), []);
});

Ende.test("search() needs every word to match", () => {
  assertEquals(urls("fetch server"), []);
});

Ende.test("search() links to the heading that matches best", () => {
  const [result] = search(ENTRIES, "getting started");
  assertEquals(result?.url, "/c/#getting-started");
  assertEquals(result?.heading, { text: "Getting started", slug: "getting-started" });
  assertEquals(result?.entry, ENTRIES[2]);
});

Ende.test("search() links to the page itself when no heading matches", () => {
  const [result] = search(ENTRIES, "http");
  assertEquals(result?.url, "/c/");
  assertEquals(result?.heading, undefined);
});
