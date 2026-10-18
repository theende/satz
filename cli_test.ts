// Copyright 2026 the Ende authors. MIT license.
import { assertEquals } from "@ende/assert";
import { join } from "@ende/path";
import { main } from "./cli.ts";

Ende.test("satz build reads _config.ts and writes dest relative to src", async () => {
  const src = await Ende.makeTempDir();
  await Ende.writeTextFile(join(src, "_config.ts"), `export default { dest: "out", data: { name: "configured" } };\n`);
  await Ende.writeTextFile(join(src, "index.page.ts"), `export default ({ name }) => String(name);\n`);
  assertEquals(await main(["build", "--src", src]), 0);
  assertEquals(await Ende.readTextFile(join(src, "out", "index.html")), "configured");
});

Ende.test("satz build --dest wins over _config.ts", async () => {
  const src = await Ende.makeTempDir();
  const dest = await Ende.makeTempDir();
  await Ende.writeTextFile(join(src, "_config.ts"), `export default { dest: "out" };\n`);
  await Ende.writeTextFile(join(src, "index.md"), "hi\n");
  assertEquals(await main(["build", "--src", src, "--dest", dest]), 0);
  assertEquals(await Ende.readTextFile(join(dest, "index.html")), "<p>hi</p>\n");
});

Ende.test("satz exits with 1 for an unknown command", async () => {
  assertEquals(await main(["serve"]), 1);
});
