import { cp, rm } from "node:fs/promises";
import { $ } from "bun";

const outDir = "dist";

await rm(outDir, { force: true, recursive: true });

// Emits dist/index.js + dist/index.d.ts (+ maps) from index.ts.
await $`tsc -p tsconfig.build.json`;

// The adapter reads templates/*.ts at runtime (index.ts resolves
// `new URL("./templates", import.meta.url)`), so ship the sources verbatim
// next to the built entrypoint rather than compiling them.
await cp("templates", `${outDir}/templates`, { recursive: true });

console.log(`Built ${outDir}/`);
