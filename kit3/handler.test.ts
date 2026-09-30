import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Server as BunServer } from "bun";

// The templates import build-time virtual modules; stand them in here. The
// handler reads its env at load time, so each case imports a fresh copy.
const manifest = {
	app_dir: "_app",
	base: "",
	embed: false,
	env_prefix: "",
	origin: undefined as string | undefined,
};
let received: Request | undefined;
mock.module("MANIFEST", () => manifest);
mock.module("ROUTES", () => ({ server_assets: new Map() }));
mock.module("SERVER", () => ({
	server: {
		init: async () => {},
		respond: async (request: Request) => {
			received = request;
			return new Response("ok");
		},
	},
}));

const saved_env = { ...process.env };
let fresh = 0;

afterEach(() => {
	process.env = { ...saved_env };
	manifest.env_prefix = "";
	manifest.origin = undefined;
	received = undefined;
});

async function load(
	env: Record<string, string>,
	{ origin, env_prefix = "" }: { origin?: string; env_prefix?: string } = {},
) {
	Object.assign(process.env, env);
	manifest.origin = origin;
	manifest.env_prefix = env_prefix;
	mock.module("MANIFEST", () => ({ ...manifest }));
	const { handler } = await import(`./templates/handler.ts?${++fresh}`);
	return handler as (r: Request, s: BunServer<undefined>) => Promise<Response>;
}

async function origin_seen(
	handler: Awaited<ReturnType<typeof load>>,
	url = "http://localhost:3001/x",
) {
	const bun_server = { timeout() {}, requestIP: () => null };
	await handler(
		new Request(url, { headers: { host: new URL(url).host } }),
		bun_server as unknown as BunServer<undefined>,
	);
	return received && new URL(received.url).origin;
}

test("ORIGIN keeps a plain-HTTP origin", async () => {
	const handler = await load({ ORIGIN: "http://localhost:3001" });
	expect(await origin_seen(handler)).toBe("http://localhost:3001");
});

test("ORIGIN is normalized to its origin", async () => {
	const handler = await load({ ORIGIN: "http://localhost:3001/app/" });
	expect(await origin_seen(handler)).toBe("http://localhost:3001");
});

test("ORIGIN overrides paths.origin", async () => {
	const handler = await load(
		{ ORIGIN: "http://localhost:3001" },
		{ origin: "https://build.example" },
	);
	expect(await origin_seen(handler)).toBe("http://localhost:3001");
});

test("paths.origin applies without ORIGIN", async () => {
	const handler = await load({}, { origin: "https://build.example" });
	expect(await origin_seen(handler)).toBe("https://build.example");
});

test("without either, falls back to https://<host>", async () => {
	const handler = await load({ ORIGIN: "" });
	expect(await origin_seen(handler)).toBe("https://localhost:3001");
});

test("an invalid ORIGIN fails at startup, naming the variable", async () => {
	await expect(load({ ORIGIN: "not a url" })).rejects.toThrow(/\bORIGIN\b/);
	await expect(
		load({ APP_ORIGIN: "ftp://x" }, { env_prefix: "APP_" }),
	).rejects.toThrow(/APP_ORIGIN/);
});

test("a prefixed ORIGIN passes the env guard", async () => {
	const handler = await load(
		{ APP_ORIGIN: "http://localhost:3001" },
		{ env_prefix: "APP_" },
	);
	expect(await origin_seen(handler)).toBe("http://localhost:3001");
	// the guard runs once per load, and the handler's env.ts loaded unprefixed
	await expect(import(`./templates/env.ts?${++fresh}`)).resolves.toBeDefined();
	process.env.APP_NOPE = "1";
	await expect(import(`./templates/env.ts?${++fresh}`)).rejects.toThrow(
		/APP_NOPE/,
	);
});

describe("parse_range", async () => {
	const { parse_range } = await import("./templates/routes-util.ts");

	test.each([
		["bytes=0-9", { start: 0, end: 9 }],
		["bytes=10-", { start: 10, end: 35 }],
		["bytes=-5", { start: 31, end: 35 }],
		["bytes=-100", { start: 0, end: 35 }],
		["bytes=30-999", { start: 30, end: 35 }],
		["bytes=35-35", { start: 35, end: 35 }],
		["BYTES=0-0", { start: 0, end: 0 }],
	])("%s is satisfiable", (header, expected) => {
		expect(parse_range(header, 36)).toEqual(expected);
	});

	test.each(["bytes=36-", "bytes=100-200", "bytes=-0"])(
		"%s is unsatisfiable",
		(header) => {
			expect(parse_range(header, 36)).toBe("unsatisfiable");
		},
	);

	test.each([
		"bytes=0-1,4-5",
		"bytes=abc",
		"bytes=-",
		"bytes=9-0",
		"bytes=1.5-3",
		"items=0-9",
		"0-9",
		"",
	])("%j is ignored", (header) => {
		expect(parse_range(header, 36)).toBeNull();
	});

	test("nothing is satisfiable in an empty file", () => {
		expect(parse_range("bytes=0-", 0)).toBe("unsatisfiable");
		expect(parse_range("bytes=-5", 0)).toBe("unsatisfiable");
	});
});
