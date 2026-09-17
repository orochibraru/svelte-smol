// Bun-free SSR entry: kit's own server output, driven by the Rust host.
// SERVER and MANIFEST are swapped for the chosen app's paths by build.sh, the
// same token trick the adapter uses on its own templates (see ../index.ts).

import { manifest } from "MANIFEST";
import { Server } from "SERVER";

const server = new Server(manifest);
// Real apps read secrets through `$env/dynamic/private`, so pass the
// process environment rather than an empty object.
const ready = server.init({ env: process.env ?? {} });

// What crosses back to Rust: plain status/headers, plus the body's reader so
// Rust can pump chunks as kit produces them (streamed `load` promises included).
const respond = (res) => {
	const headers = {};
	res.headers.forEach((v, k) => {
		headers[k] = v;
	});
	return { status: res.status, headers, reader: res.body?.getReader() ?? null };
};

// `body` arrives as a Uint8Array (or null) — the same BodyInit kit gets on Bun.
globalThis.__handle = async (method, url, headers, body) => {
	await ready;
	const request = new Request(url, { method, headers, body });
	switch (new URL(url).pathname) {
		// Proof that a host binding replaces a Bun API: the `bun:sqlite` shape,
		// served from the same binary, with no JS runtime shipped.
		case "/_sqlite":
			return respond(
				new Response(
					globalThis.__sqlite("SELECT id, name FROM users ORDER BY id"),
					{
						headers: { "content-type": "application/json" },
					},
				),
			);
		// Bytes in, same bytes out — the path a file upload takes through kit.
		case "/_echo":
			return respond(new Response(await request.arrayBuffer()));
		// Chunks flushed as produced; the client sees them ~300ms apart.
		case "/_stream":
			return respond(
				new Response(
					new ReadableStream({
						async start(c) {
							for (const chunk of ["one\n", "two\n", "three\n"]) {
								c.enqueue(new TextEncoder().encode(chunk));
								await new Promise((r) => setTimeout(r, 300));
							}
							c.close();
						},
					}),
				),
			);
		default:
			return respond(
				await server.respond(request, { getClientAddress: () => "127.0.0.1" }),
			);
	}
};
