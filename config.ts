// Copyright 2026 the Ende authors. MIT license.
import { join, toFileUrl } from "@ende/path";
import type { BuildOptions, PageData } from "./build.ts";

/** What `_config.ts` may export. */
export interface Config {
  /** Files and directories copied as they are (see `BuildOptions.copy`). */
  copy?: Record<string, string>;
  /** Data every page receives. */
  data?: PageData;
  /** Where the site is written, relative to `src`. */
  dest?: string;
  /** Files and directories that aren't part of the site (see `BuildOptions.ignore`). */
  ignore?: string[];
  /** The site's absolute URL, e.g. `https://docs.ende.sh`. */
  location?: string;
  /** Redirects by old URL (see `BuildOptions.redirects`). */
  redirects?: Record<string, string>;
  /** Whether to write the search index and client (see `BuildOptions.search`). */
  search?: boolean;
}

/** The build options a config sets, apart from `data` and `dest`, which the caller resolves. */
export function configOptions(config: Config): BuildOptions {
  const options: BuildOptions = {};

  if (config.copy !== undefined)
    options.copy = config.copy;

  if (config.ignore !== undefined)
    options.ignore = config.ignore;

  if (config.location !== undefined)
    options.location = config.location;

  if (config.redirects !== undefined)
    options.redirects = config.redirects;

  if (config.search !== undefined)
    options.search = config.search;

  return options;
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
