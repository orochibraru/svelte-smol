/* global ENV_PREFIX, BUILD_OPTIONS */

import { env } from "ENV";
import { base, manifest, prerendered } from "MANIFEST";
import { Server } from "SERVER";
import { existsSync } from "node:fs";
import type { Server as SvelteKitServer } from "@sveltejs/kit";

const server = new Server(manifest) as SvelteKitServer & {
	websocket?: () => Bun.WebSocketHandler<undefined> | undefined;
};

const { serveAssets } = BUILD_OPTIONS;

const origin = env("ORIGIN", undefined);
const xff_depth = Number.parseInt(env("XFF_DEPTH", "1"), 10);
const address_header = env("ADDRESS_HEADER", "").toLowerCase();
const protocol_header = env("PROTOCOL_HEADER", "").toLowerCase();
const host_header = env("HOST_HEADER", "").toLowerCase();
const port_header = env("PORT_HEADER", "").toLowerCase();

const client_dir = `${import.meta.dir}/client${base}`;
const prerendered_dir = `${import.meta.dir}/prerendered`;

await server.init({
	env: Bun.env as Record<string, string>,
	read: (file) => Bun.file(`${client_dir}/${file}`).stream(),
});

function buildStaticRoutes() {
	const routes: Record<
		string,
		Bun.Serve.DirectoryRouteOptions | Bun.BunFile | ((req: Request) => Response)
	> = {};

	const immutable_dir = `${client_dir}/${manifest.appDir}/immutable`;
	if (existsSync(immutable_dir)) {
		routes[`${base}/${manifest.appDir}/immutable/*`] = { dir: immutable_dir };
	}

	if (existsSync(client_dir)) {
		const immutable_prefix = `${manifest.appDir}/immutable/`;
		for (const rel of new Bun.Glob("**/*").scanSync({ cwd: client_dir })) {
			if (rel.startsWith(immutable_prefix)) {
				continue; // handled above
			}
			routes[`${base}/${rel}`] = Bun.file(`${client_dir}/${rel}`);
		}
	}

	for (const path of prerendered) {
		const file =
			path === "/"
				? "index.html"
				: path.endsWith("/")
					? `${path.slice(1)}index.html`
					: `${path.slice(1)}.html`;
		routes[path] = Bun.file(`${prerendered_dir}/${file}`);

		// The other trailing-slash form of a prerendered path redirects to
		// the canonical one, preserving the query string (matches
		// SvelteKit's own trailingSlash handling). Skipped when that form is
		// itself a distinct prerendered entry, it gets its own real route
		// above instead of a redirect.
		const toggled = path.endsWith("/") ? path.slice(0, -1) : `${path}/`;
		if (!prerendered.has(toggled) && !(toggled in routes)) {
			routes[toggled] = (req: Request) => {
				const { search } = new URL(req.url);
				return new Response(null, {
					headers: { location: path + search },
					status: 308,
				});
			};
		}
	}

	return routes;
}

const ssr = async (request: Request, bunServer: Bun.Server<undefined>) => {
	const baseOrigin = origin || get_origin(request.headers);
	const url = request.url.slice(request.url.split("/", 3).join("/").length);
	const newRequest = new Request(baseOrigin + url, request);

	const response = await server.respond(newRequest, {
		getClientAddress() {
			if (address_header) {
				if (!request.headers.has(address_header)) {
					throw new Error(
						`Address header was specified with ${`${ENV_PREFIX}ADDRESS_HEADER`}=${address_header} but is absent from request`,
					);
				}

				const value = request.headers.get(address_header) || "";

				if (address_header === "x-forwarded-for") {
					const addresses = value.split(",");

					if (xff_depth < 1) {
						throw new Error(
							`${`${ENV_PREFIX}XFF_DEPTH`} must be a positive integer`,
						);
					}

					if (xff_depth > addresses.length) {
						throw new Error(
							`${`${ENV_PREFIX}XFF_DEPTH`} is ${xff_depth}, but only found ${addresses.length} addresses`,
						);
					}
					return addresses[addresses.length - xff_depth]?.trim() || "";
				}

				return value;
			}

			return bunServer.requestIP(request)?.address || "";
		},
		platform: { request, server: bunServer },
	});

	// SvelteKit streams Server-Sent Events with no Content-Length and long
	// gaps between writes; Bun's idleTimeout (default 10s) would sever the
	// connection between events. Disable it for the life of this response.
	if (response.headers.get("content-type")?.startsWith("text/event-stream")) {
		bunServer.timeout(request, 0);
	}

	return response;
};

export const getHandler = () => {
	const websocket =
		typeof server.websocket === "function" ? server.websocket() : undefined;

	return {
		fetch: ssr,
		routes: serveAssets ? buildStaticRoutes() : {},
		websocket,
	};
};

function get_origin(headers: Headers) {
	const protocol = (protocol_header && headers.get(protocol_header)) || "https";
	const host = (host_header && headers.get(host_header)) || headers.get("host");
	const port = port_header && headers.get(port_header);

	return port ? `${protocol}://${host}:${port}` : `${protocol}://${host}`;
}
