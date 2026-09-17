import { healthcheck_path } from "MANIFEST";
import server_options from "SERVER_OPTIONS";
import process from "node:process";
import { env, number_env } from "./env.ts";

const unix = env("SOCKET_PATH", server_options.unix);
const timeout = number_env("HEALTHCHECK_TIMEOUT", 2000);
const path = env("HEALTHCHECK_PATH", healthcheck_path || "/_health");

// a server bound to a wildcard address is reached over loopback
const raw_host = env("HOST", server_options.hostname) ?? "";
const host = ["", "0.0.0.0", "::"].includes(raw_host) ? "127.0.0.1" : raw_host;
const port = env("PORT", server_options.port?.toString()) ?? 3000;

const url = unix
	? `http://localhost${path}`
	: `http://${host.includes(":") ? `[${host}]` : host}:${port}${path}`;

try {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(timeout),
		...(unix ? { unix } : {}),
	});
	if (!response.ok) throw new Error(`status ${response.status}`);
	process.exit(0);
} catch (error) {
	console.error(
		`unhealthy: ${url} -> ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(1);
}
