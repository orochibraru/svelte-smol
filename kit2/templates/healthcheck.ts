/* global BUILD_OPTIONS */

import { env } from "ENV";
import process from "node:process";

const { healthcheck } = BUILD_OPTIONS;

if (!healthcheck) {
	console.error("healthcheck is disabled for this build");
	process.exit(2);
}

const socket = env("SOCKET_PATH", false);
const timeout_ms = Number.parseInt(env("HEALTHCHECK_TIMEOUT", "2000"), 10);
const path = env("HEALTHCHECK_PATH", healthcheck.path);

// A server bound to a wildcard address is reached over loopback.
const raw_host = env("HOST", "0.0.0.0");
const host =
	raw_host === "0.0.0.0" || raw_host === "::" || raw_host === ""
		? "127.0.0.1"
		: raw_host;
const port = env("PORT", "3000");

const url = socket
	? `http://localhost${path}`
	: `http://${host.includes(":") ? `[${host}]` : host}:${port}${path}`;

function fail(reason: string): never {
	console.error(`unhealthy: ${reason}`);
	process.exit(1);
}

try {
	const response = await fetch(url, {
		headers: { "user-agent": "svelte-smol-healthcheck" },
		signal: AbortSignal.timeout(timeout_ms),
		...(socket ? { unix: socket } : {}),
	});

	if (!response.ok) {
		fail(`${url} -> ${response.status}`);
	}

	const body = (await response.json().catch(() => null)) as {
		status?: string;
	} | null;
	if (body?.status && body.status !== "ok") {
		fail(`status=${body.status}`);
	}

	process.exit(0);
} catch (error) {
	fail(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
}
