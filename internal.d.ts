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
		websocket: Bun.WebSocketHandler<undefined> | undefined;
	};
}

declare module "MANIFEST" {
	export const base: string;
	/** `builder.getAppPath()`, base included, no leading slash. */
	export const app_path: string;
	export const prerendered: Set<string>;
}

declare module "SERVER" {
	export const server: import("@sveltejs/kit").Server;
}

declare const ENV_PREFIX: string;
declare const BUILD_OPTIONS: {
	serveAssets: boolean;
	precompress: boolean;
	healthcheck: false | { path: string };
	compiled: boolean;
};
declare const SERVE_OPTIONS: Record<string, unknown>;
