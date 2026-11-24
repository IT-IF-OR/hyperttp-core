import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const artifact = fileURLToPath(new URL("../dist/utils/modules.js", import.meta.url));
const source = await readFile(artifact, "utf8");

assert.match(source, /import\(\s*\/\*\s*@vite-ignore\s*\*\/\s*\w+\s*\)/);
console.log("Core artifact retains the Vite dynamic-import directive");
