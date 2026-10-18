// Copyright 2026 the Ende authors. MIT license.
import { join, toFileUrl } from "@ende/path";
import type { PageData } from "./build.ts";

/** What `_config.ts` may export. */
export interface Config {
  /** Data every page receives. */
  data?: PageData;
  /** Where the site is written, relative to `src`. */
  dest?: string;
  /** The site's absolute URL, e.g. `https://docs.ende.sh`. */
  location?: string;
}

/** Loads `<src>/_config.ts`, or returns `{}` when there isn't one. */
export async function loadConfig(src: string): Promise<Config> {
  const path = join(src, "_config.ts");

  try {
    await Ende.stat(path);
  } catch (error) {
    if (error instanceof Ende.errors.NotFound)
      return {};

    throw error;
  }

  const config = (await import(toFileUrl(path).href)).default;

  if (typeof config !== "object" || config === null)
    throw new Error(`${path} must default-export an object`);

  return config;
}
