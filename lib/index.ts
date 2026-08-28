import { env } from "ENV";
import { getHandler } from "HANDLER";
import process from "node:process";

export const path = env("SOCKET_PATH", false);
export const host = env("HOST", "0.0.0.0");
export const port = env("PORT", "3000");

const body_size_limit = parse_as_bytes(env("BODY_SIZE_LIMIT", "512K"));
if (Number.isNaN(body_size_limit)) {
	throw new Error(
		`Invalid BODY_SIZE_LIMIT: '${env("BODY_SIZE_LIMIT", "512K")}'. Please provide a numeric value.`,
	);
}

const idle_timeout = Number.parseInt(env("IDLE_TIMEOUT", "10"), 10);
const { fetch: handlerFetch, routes, websocket } = getHandler();

const options = {
	...SERVE_OPTIONS,
	fetch: handlerFetch,
	idleTimeout: idle_timeout,
	maxRequestBodySize: body_size_limit,
	routes,
	...(path ? { unix: path } : { hostname: host, port: port }),
	...(websocket ? { websocket } : {}),
};

const server = Bun.serve(options as Parameters<typeof Bun.serve>[0]);

console.log(`Listening on ${server.url} ${websocket ? "with WebSocket" : ""}`);

const shutdown_timeout_ms =
	Number.parseInt(env("SHUTDOWN_TIMEOUT", "30"), 10) * 1000;
let shutting_down = false;

async function graceful_shutdown(reason: "SIGINT" | "SIGTERM" | "IDLE") {
	if (shutting_down) {
		console.info(`Received ${reason} again, forcing immediate shutdown.`);
		process.exit(1);
	}
	shutting_down = true;

	console.info(
		`Stopping server (waiting up to ${shutdown_timeout_ms / 1000}s for in-flight requests to finish)...`,
	);
	process.emit("sveltekit:shutdown", reason);

	const force_timer = setTimeout(() => {
		console.warn(
			`Graceful shutdown exceeded ${shutdown_timeout_ms / 1000}s, forcing.`,
		);
		server.stop(true).finally(() => process.exit(1));
	}, shutdown_timeout_ms);

	await server.stop();
	clearTimeout(force_timer);
	console.info("Stopped server");
	process.exit(0);
}

process.on("SIGTERM", graceful_shutdown);
process.on("SIGINT", graceful_shutdown);

export { server };

function parse_as_bytes(value: string): number {
	const units = value.at(-1)?.toUpperCase();
	const multiplier =
		{
			B: 1,
			G: 1024 * 1024 * 1024,
			K: 1024,
			M: 1024 * 1024,
		}[units ?? "B"] ?? 1;
	return Number(multiplier !== 1 ? value.slice(0, -1) : value) * multiplier;
}
