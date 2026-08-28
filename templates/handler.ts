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

// Homerun delta from upstream, and from this app's own first vendored pass :
// upstream (and our first cut) served every static asset, and prerendered
// pages, through a hand-rolled sirv-based fetch handler running on every
// request. Bun 1.4 added native `routes` support for exactly this (a `dir`
// route for a directory tree, or a bare `Bun.file()`/`Response` as a route
// value for one exact path), handled in Bun's own native code with no JS in
// the hot path : real Range/HEAD/If-Modified-Since support, verified live
// against a throwaway Bun.serve() (200/206/304 all correct; no ETag header
// though, only Last-Modified-based conditional GETs). vendor/sirv.ts and its
// mrmime/totalist dependencies are gone entirely, replaced by:
//
// - a wildcard `dir` route for `${appDir}/immutable/*`, SvelteKit's
//   content-hashed build output. Safe as a wildcard because SvelteKit
//   reserves that whole prefix, no app route can ever collide with it. The
//   one thing lost versus the old sirv `setHeaders` : Bun's
//   `DirectoryRouteOptions` has no header hook, so there's no explicit
//   `Cache-Control: immutable` any more, callers rely on Last-Modified
//   conditional requests instead (accepted trade-off, filenames are
//   content-hashed so staleness was never a risk either way).
// - one exact route per remaining file under `client/` (favicon,
//   manifest.webmanifest, a service worker, ${appDir}/version.json, ...).
//   Deliberately *not* a second wildcard `dir` route : Bun's own doc for
//   `DirectoryRouteOptions` says a miss inside a `dir` route 404s outright,
//   it does not fall through to `fetch`, which would break every real app
//   route that doesn't happen to correspond to a static file. Exact routes
//   don't have that problem, an unmatched app route just isn't one of these
//   keys and falls through to `fetch` normally.
// - one exact route per prerendered page (from the `prerendered` Set
//   SvelteKit already resolved at build time, no runtime existence checks
//   needed), plus a redirect route for the other trailing-slash form of
//   each, mirroring what the old `serve_prerendered()` did by hand.
//
// Dotfiles (a stray `.env` dropped in `static/`, etc.) are excluded the same
// way sirv's own default did : `Bun.Glob`'s default `dot: false` simply
// never matches them, no filtering required.
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

	return server.respond(newRequest, {
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
