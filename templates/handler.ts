/* global ENV_PREFIX, BUILD_OPTIONS */

import { env } from "ENV";
import { base, manifest, prerendered } from "MANIFEST";
import { Server } from "SERVER";
import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Server as SvelteKitServer } from "@sveltejs/kit";

const server = new Server(manifest) as SvelteKitServer & {
	websocket?: () => Bun.WebSocketHandler<undefined> | undefined;
};

const { serveAssets, precompress } = BUILD_OPTIONS;

const origin = env("ORIGIN", undefined);
const xff_depth = Number.parseInt(env("XFF_DEPTH", "1"), 10);
const address_header = env("ADDRESS_HEADER", "").toLowerCase();
const protocol_header = env("PROTOCOL_HEADER", "").toLowerCase();
const host_header = env("HOST_HEADER", "").toLowerCase();
const port_header = env("PORT_HEADER", "").toLowerCase();

// Static assets and prerendered pages are deployed next to the executable:
//   <dir>/<binary>
//   <dir>/client/…
//   <dir>/prerendered/…
// `ASSETS_DIR` overrides that parent directory (absolute, or relative to the
// binary). `import.meta.dir` is a virtual path inside a compiled binary, so
// the real on-disk location comes from `process.execPath`.
const assets_root = resolve(dirname(process.execPath), env("ASSETS_DIR", ""));
const client_dir = `${assets_root}/client${base}`;
const prerendered_dir = `${assets_root}/prerendered${base}`;
const immutable_prefix = `${base}/${manifest.appDir}/immutable/`;

await server.init({
	env: Bun.env as Record<string, string>,
	read: (file) => Bun.file(`${client_dir}/${file}`).stream(),
});

// Pre-compressed sibling files, tried in this order when `precompress` is on.
const encodings: Array<readonly [token: string, ext: string]> = precompress
	? [
			["br", ".br"],
			["gzip", ".gz"],
		]
	: [];

/** `statSync` that yields `undefined` for a missing path or a non-file. */
function file_stat(path: string) {
	try {
		const stat = statSync(path);
		return stat.isFile() ? stat : undefined;
	} catch {
		return undefined;
	}
}

function asset_response(
	file: string,
	request: Request,
	immutable = false,
): Response | undefined {
	let stat = file_stat(file);
	if (!stat) {
		return undefined;
	}

	const headers = new Headers();
	headers.set(
		"cache-control",
		immutable
			? "public,max-age=31536000,immutable"
			: "public,max-age=0,must-revalidate",
	);

	let body = file;
	const accept = request.headers.get("accept-encoding") ?? "";
	for (const [token, ext] of encodings) {
		const compressed = accept.includes(token) && file_stat(`${file}${ext}`);
		if (compressed) {
			body = `${file}${ext}`;
			stat = compressed;
			headers.set("content-encoding", token);
			headers.set("vary", "Accept-Encoding");
			// The compressed sibling has no useful media type of its own.
			headers.set("content-type", Bun.file(file).type);
			break;
		}
	}

	const { size, mtimeMs } = stat;
	const etag = `W/"${size.toString(16)}-${Math.round(mtimeMs).toString(16)}"`;
	if (request.headers.get("if-none-match") === etag) {
		return new Response(null, { headers, status: 304 });
	}
	headers.set("etag", etag);

	return new Response(Bun.file(body), { headers });
}

function serve_static(url: URL, request: Request): Response | undefined {
	if (!serveAssets) {
		return undefined;
	}

	const { pathname } = url;
	const rel = pathname.startsWith(base)
		? pathname.slice(base.length)
		: pathname;

	if (prerendered.has(pathname)) {
		const file =
			rel === "/" || rel === ""
				? "index.html"
				: rel.endsWith("/")
					? `${rel.slice(1)}index.html`
					: `${rel.slice(1)}.html`;
		return asset_response(`${prerendered_dir}/${file}`, request);
	}

	// The other trailing-slash form of a prerendered path redirects to the
	// canonical one, query string preserved (matches SvelteKit's own
	// trailingSlash handling).
	const toggled = pathname.endsWith("/")
		? pathname.slice(0, -1)
		: `${pathname}/`;
	if (prerendered.has(toggled)) {
		return new Response(null, {
			headers: { location: toggled + url.search },
			status: 308,
		});
	}

	return asset_response(
		`${client_dir}/${rel.slice(1)}`,
		request,
		pathname.startsWith(immutable_prefix),
	);
}

const ssr = async (request: Request, bunServer: Bun.Server<undefined>) => {
	const url = new URL(request.url);

	const asset = serve_static(url, request);
	if (asset) {
		return asset;
	}

	const baseOrigin = origin || get_origin(request.headers);
	const path = request.url.slice(request.url.split("/", 3).join("/").length);
	const newRequest = new Request(baseOrigin + path, request);

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
		websocket,
	};
};

function get_origin(headers: Headers) {
	const protocol = (protocol_header && headers.get(protocol_header)) || "https";
	const host = (host_header && headers.get(host_header)) || headers.get("host");
	const port = port_header && headers.get(port_header);

	return port ? `${protocol}://${host}:${port}` : `${protocol}://${host}`;
}
