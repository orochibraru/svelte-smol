// Ambient declarations for the virtual specifiers/globals `templates/*.ts`
// reference. None of these are real modules or runtime globals at
// type-check time, `index.ts`'s adapt() resolves them via a raw text
// replacement over the compiled output (see its `builder.copy(..., {
// replace })` call), so this file exists purely so `templates/*.ts`
// typechecks against the shape that replacement actually produces.

declare module "ENV" {
	export function env(name: string, fallback: string): string;
	export function env(name: string, fallback: false): string | false;
	export function env(name: string, fallback?: undefined): string | undefined;
}

declare module "HANDLER" {
	export function getHandler(): {
		fetch: (
			request: Request,
			server: Bun.Server<undefined>,
		) => Response | Promise<Response>;
		routes: Record<
			string,
			| Bun.Serve.DirectoryRouteOptions
			| Bun.BunFile
			| ((req: Request) => Response)
		>;
		websocket: Bun.WebSocketHandler<undefined> | undefined;
	};
}

declare module "MANIFEST" {
	import type { SSRManifest } from "@sveltejs/kit";

	export const base: string;
	export const manifest: SSRManifest;
	export const prerendered: Set<string>;
}

declare module "SERVER" {
	export { Server } from "@sveltejs/kit";
}

declare const ENV_PREFIX: string;
declare const BUILD_OPTIONS: { serveAssets: boolean };
declare const SERVE_OPTIONS: Record<string, unknown>;
