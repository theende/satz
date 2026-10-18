// Copyright 2026 the Ende authors. MIT license.
/**
 * Ranks the entries of a site's `search.json` for a query. It has no
 * dependencies, so it runs in the browser: with `search: true`, `satz build`
 * writes it as JavaScript to `/_satz/search.js` for the site's own scripts to
 * import.
 *
 * ```ts
 * import { search, type SearchEntry } from "@ende/satz/search";
 * import { assertEquals } from "@ende/assert";
 *
 * const entries: SearchEntry[] = [
 *   { url: "/serve/", title: "HTTP server", headings: [{ text: "Serve files", slug: "serve-files" }] },
 *   { url: "/fetch/", title: "Fetch", text: "Fetch a resource over HTTP." }
 * ];
 *
 * assertEquals(search(entries, "serve fi").map(result => result.url), ["/serve/#serve-files"]);
 * ```
 *
 * @module
 */

/** A heading of a page, for linking straight to it. */
export interface SearchHeading {
  /** The heading's text. */
  text: string;
  /** The heading's id, without `#`. */
  slug: string;
}

/** A page in `search.json`. */
export interface SearchEntry {
  /** The page's URL. */
  url: string;
  /** The page's title. */
  title: string;
  /** The page's description, if it has one. */
  description?: string;
  /** The page's headings below the title, if it has any. */
  headings?: SearchHeading[];
  /** The start of the page's text, without code blocks, if it has any. */
  text?: string;
}

/** A page that matches a query. */
export interface SearchResult {
  /** The page's URL, with `#slug` when a heading matched. */
  url: string;
  /** The page. */
  entry: SearchEntry;
  /** The heading that matched best, if any did. */
  heading?: SearchHeading;
  /** How well the page matches; results are sorted by it, highest first. */
  score: number;
}

// How much a word found in each part of a page counts.
const TITLE = 8;
const HEADING = 4;
const DESCRIPTION = 2;
const TEXT = 1;

/**
 * Finds the entries that match every word of `query`, best first. Matching
 * ignores case; the last word matches as a prefix (so results show while
 * typing) and the others as whole words. A word counts for the most important
 * part of the page it's in: the title, then a heading, the description, the
 * text.
 *
 * @param entries The entries of `search.json`.
 * @param query What was typed.
 * @returns The matching entries, best first; equal scores keep the entries' order.
 */
export function search(entries: SearchEntry[], query: string): SearchResult[] {
  const words = query.toLowerCase().split(/\s+/).filter(word => word !== "");

  if (words.length === 0)
    return [];

  const results: SearchResult[] = [];

  for (const entry of entries) {
    const result = match(entry, words);

    if (result !== undefined)
      results.push(result);
  }

  // Array#sort is stable, so equal scores keep the entries' order.
  return results.sort((a, b) => b.score - a.score);
}

function match(entry: SearchEntry, words: string[]): SearchResult | undefined {
  const title = entry.title.toLowerCase();
  const description = entry.description?.toLowerCase() ?? "";
  const text = entry.text?.toLowerCase() ?? "";
  const headings = (entry.headings ?? []).map(heading => heading.text.toLowerCase());
  const headingHits = headings.map(() => 0);
  let score = 0;

  for (const [i, word] of words.entries()) {
    const prefix = i === words.length - 1;
    let best = 0;

    if (contains(title, word, prefix))
      best = TITLE;

    headings.forEach((heading, h) => {
      if (contains(heading, word, prefix)) {
        headingHits[h]! += 1;
        best = Math.max(best, HEADING);
      }
    });

    if (best < DESCRIPTION && contains(description, word, prefix))
      best = DESCRIPTION;

    if (best < TEXT && contains(text, word, prefix))
      best = TEXT;

    if (best === 0)
      return undefined;

    score += best;
  }

  const most = Math.max(0, ...headingHits);
  const heading = most === 0 ? undefined : entry.headings![headingHits.indexOf(most)]!;

  return heading === undefined ?
    { url: entry.url, entry, score } :
    { url: `${entry.url}#${heading.slug}`, entry, heading, score };
}

/** Whether `word` starts a word in `haystack`, and (unless `prefix`) ends one. */
function contains(haystack: string, word: string, prefix: boolean): boolean {
  for (let at = haystack.indexOf(word); at !== -1; at = haystack.indexOf(word, at + 1)) {
    if (at > 0 && isWordChar(haystack[at - 1]!))
      continue;

    const end = at + word.length;

    if (prefix || end === haystack.length || !isWordChar(haystack[end]!))
      return true;
  }

  return false;
}

function isWordChar(char: string): boolean {
  return /[\p{L}\p{N}_]/u.test(char);
}
