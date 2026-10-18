// Copyright 2026 the Ende authors. MIT license.
import { assertEquals } from "@ende/assert";
import { join } from "@ende/path";
import { searchClientModule } from "./gen_search_client.ts";

Ende.test("_search_client.ts matches search.ts (run `ende task gen` after changing search.ts)", async () => {
  assertEquals(await Ende.readTextFile(join(import.meta.dirname!, "..", "_search_client.ts")), await searchClientModule());
});
