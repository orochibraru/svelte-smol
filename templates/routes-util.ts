import { app_dir, base, embed } from "MANIFEST";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BunRequest, Serve } from "bun";

type RouteHandler = Serve.Routes<undefined, string>[string];
type AssetMeta = { hash: string; mtime: number; br?: boolean; gz?: boolean };

// not Bun.main: when the built server is imported from a wrapper script rather than
// run directly, Bun.main is the wrapper and every asset path resolves wrong
const dir = path.dirname(fileURLToPath(import.meta.url));

/** Embedded assets are imported by identity path; on-disk assets live next to this module. */
function resolve_file(subdir: string, filename: string) {
	return embed ? filename : path.resolve(dir, subdir, filename);
}

const CONTENT_ENCODING = { br: "br", gz: "gzip" };

// the URL Standard's path percent-encode set, plus `%` and `\` so they stay literal
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are part of the encode set
const ESCAPED_PATH_CHAR = /[\u0000-\u001f\u007f-\u{10ffff} "#<>?`{}%\\]/gu;

/**
 * WHATWG path serialization: the exact bytes user agents put on the wire, because
 * Bun matches route keys against the raw request pathname.
 */
function encode_pathname(pathname: string) {
	return pathname.replace(ESCAPED_PATH_CHAR, (char) =>
		encodeURIComponent(char),
	);
}

/** Registers a path both as user agents send it and fully percent-encoded. */
function route_paths(pathname: string) {
	const minimal = encode_pathname(pathname);
	const full = pathname.split("/").map(encodeURIComponent).join("/");
	return minimal === full ? [minimal] : [minimal, full];
}

function to_paths(url: string) {
	return route_paths(path.posix.join(base, url));
}

function to_directory_paths(url: string) {
	const directory = `${path.posix.join(base, url).replace(/\/$/, "")}/`;
	const paths = route_paths(directory);
	if (directory !== "/") {
		paths.push(...route_paths(directory.slice(0, -1)));
	}
	return paths;
}

/**
 * If-None-Match takes precedence over If-Modified-Since (RFC 9110 §13.1.3);
 * dates compare at whole-second precision because HTTP dates have none finer.
 */
function is_fresh(request: Request, etag: string, mtime: number) {
	const header = request.headers.get("if-none-match");
	if (header !== null) {
		return header
			.split(",")
			.some((value) => ["*", etag].includes(value.trim().replace(/^W\//, "")));
	}

	const since = Date.parse(request.headers.get("if-modified-since") ?? "");
	return (
		Number.isFinite(since) &&
		Math.trunc(mtime / 1000) <= Math.trunc(since / 1000)
	);
}

function negotiate(accept: string | null, meta: AssetMeta): "br" | "gz" | null {
	if (accept === null || (!meta.br && !meta.gz)) return null;

	const accepted = new Set<string>();
	for (const part of accept.split(",")) {
		const [name = "", ...params] = part.trim().toLowerCase().split(";");
		if (params.some((param) => /^q=0(\.0*)?$/.test(param.trim()))) continue;
		accepted.add(name.trim());
	}

	if (meta.br && (accepted.has("br") || accepted.has("*"))) return "br";
	if (meta.gz && (accepted.has("gzip") || accepted.has("*"))) return "gz";
	return null;
}

function route_entries(
	paths: string[],
	route: RouteHandler,
): Array<[string, RouteHandler]> {
	return paths.map((route_path) => [route_path, route]);
}

/** Serves one file with its build-time validator and precompressed variants. */
function file_route(
	file: string,
	meta: AssetMeta,
	extra_headers: Record<string, string> = {},
): RouteHandler {
	const content_type = Bun.file(file).type;
	const last_modified = new Date(meta.mtime).toUTCString();

	const handler = (request: BunRequest) => {
		// Bun serializes Range itself for file bodies; ranges apply to the identity representation
		const encoding =
			request.headers.get("range") === null
				? negotiate(request.headers.get("accept-encoding"), meta)
				: null;
		const etag =
			encoding === null ? `"${meta.hash}"` : `"${meta.hash}-${encoding}"`;

		const response_headers: Record<string, string> = {
			"content-type": content_type,
			...extra_headers,
			etag,
			"last-modified": last_modified,
		};
		if (meta.br || meta.gz) response_headers.vary = "accept-encoding";

		if (is_fresh(request, etag, meta.mtime)) {
			return new Response(null, { status: 304, headers: response_headers });
		}

		let body_file = file;
		if (encoding !== null) {
			response_headers["content-encoding"] = CONTENT_ENCODING[encoding];
			body_file = `${file}.${encoding}`;
		}
		return new Response(Bun.file(body_file), { headers: response_headers });
	};

	return { GET: handler };
}

export function client_asset(
	url: string,
	filename: string | undefined,
	meta: AssetMeta,
) {
	const immutable = url.startsWith(`${app_dir}/immutable/`);
	const route = file_route(
		resolve_file("client", filename ?? url),
		meta,
		immutable ? { "cache-control": "public,max-age=31536000,immutable" } : {},
	);

	const paths = to_paths(url);
	if (url.endsWith("/index.html") || url === "index.html") {
		paths.push(...to_directory_paths(url.slice(0, -"index.html".length)));
	} else if (url.endsWith(".html")) {
		// sirv also serves `page.html` at `/page`
		paths.push(...to_paths(url.slice(0, -".html".length)));
	}

	return route_entries(paths, route);
}

export function server_asset(url: string, filename = url) {
	return Bun.file(resolve_file("client", filename));
}

export function prerendered_asset(
	url: string,
	filename: string | undefined,
	meta: AssetMeta,
) {
	const route = file_route(resolve_file("prerendered", filename ?? url), meta);
	return route_entries(to_paths(url), route);
}

export function prerendered_page(
	url: string,
	filename: string,
	meta: AssetMeta,
) {
	const route = file_route(resolve_file("prerendered", filename), meta);
	// path already contains base, no need to add it here
	const entries = route_entries(route_paths(url), route);

	const inverted = url.endsWith("/") ? url.slice(0, -1) : `${url}/`;
	if (inverted) {
		const canonical = encode_pathname(url);
		entries.push(
			...route_entries(route_paths(inverted), {
				GET: (req: BunRequest) => {
					const location = canonical + new URL(req.url).search;
					return new Response(null, { status: 308, headers: { location } });
				},
			}),
		);
	}

	return entries;
}

export function prerendered_redirect(
	url: string,
	status: number,
	location: string,
) {
	const route = {
		GET: new Response(null, { status, headers: { location } }),
	};
	// path already contains base, no need to add it here
	return route_entries(route_paths(url), route);
}
