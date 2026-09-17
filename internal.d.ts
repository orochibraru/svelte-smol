// Virtual modules the `templates/*.ts` import. `index.ts`'s Bun plugin resolves
// them at build time; these declarations only exist so the templates typecheck.

declare module "MANIFEST" {
	export const app_dir: string;
	export const base: string;
	/** assets are embedded into a compiled executable */
	export const embed: boolean;
	export const env_prefix: string;
	export const origin: string | undefined;
	export const healthcheck_path: string | false;
}

declare module "SERVER" {
	export const server: import("@sveltejs/kit").Server;
}

declare module "ROUTES" {
	export const routes: import("bun").Serve.Routes<undefined, string>;
	export const server_assets: Map<string, import("bun").BunFile>;
}

declare module "SERVER_OPTIONS" {
	const options: NonNullable<
		import("./index.ts").AdapterOptions["serverOptions"]
	>;
	export default options;
}
