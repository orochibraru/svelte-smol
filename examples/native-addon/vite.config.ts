import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import adapter from "@orochibraru/svelte-smol";

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
			},

			// `sharp` ships a native (.node) addon that `bun build --compile`
			// can't embed, so this app is built as a plain `build/index.js`
			// bundle instead, run with `bun` alongside `node_modules`.
			adapter: adapter({ compile: false }),
		}),
	],
});
