import type { Adapter } from "@sveltejs/kit";
import kit2, {
	type AdapterOptions as Kit2AdapterOptions,
} from "./kit2/index.js";
import kit3, {
	type AdapterOptions as Kit3AdapterOptions,
} from "./kit3/index.js";

export type { Kit2AdapterOptions, Kit3AdapterOptions };
export type AdapterOptions = Kit2AdapterOptions | Kit3AdapterOptions;

const KIT2_ONLY = [
	"name",
	"compile",
	"target",
	"bytecode",
	"minify",
	"sourcemap",
	"serveAssets",
	"serveOptions",
];
const KIT3_ONLY = ["buildOptions", "serverOptions"];

/**
 * SvelteKit adapter that compiles the app into a standalone Bun executable.
 * Runs the SvelteKit 2 or SvelteKit 3 implementation, whichever SvelteKit is
 * building the app.
 *
 * @example
 * ```typescript
 * // svelte.config.js (SvelteKit 2)
 * import adapter from "@orochibraru/svelte-smol";
 *
 * export default { kit: { adapter: adapter() } };
 * ```
 */
export default function adapter(options: AdapterOptions = {}): Adapter {
	return {
		name: "@orochibraru/svelte-smol",
		supports: {
			instrumentation: () => true,
			read: () => true,
		},
		adapt(builder) {
			const is_kit3 = "generateServerInstance" in builder;
			const unsupported = Object.keys(options).filter((key) =>
				(is_kit3 ? KIT2_ONLY : KIT3_ONLY).includes(key),
			);
			if (unsupported.length > 0) {
				throw new Error(
					`svelte-smol: ${unsupported.join(", ")} not supported with SvelteKit ${is_kit3 ? 3 : 2}. See https://github.com/orochibraru/svelte-smol/blob/main/docs/sveltekit-3.md for the option mapping.`,
				);
			}
			return is_kit3
				? kit3(options as Kit3AdapterOptions).adapt(builder)
				: kit2(options as Kit2AdapterOptions).adapt(builder);
		},
	};
}
