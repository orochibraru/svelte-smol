import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import adapter from "../../../index.ts";

// The integration suite builds this fixture in both modes: `SMOL_COMPILE=false`
// exercises the plain `build/index.js` bundle path, the only one that precompresses.
const compile = process.env.SMOL_COMPILE !== "false";

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter({ precompress: true, buildOptions: { compile } }),
		}),
	],
	logLevel: "warn",
});
