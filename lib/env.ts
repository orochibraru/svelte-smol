/* global ENV_PREFIX */

const expected = new Set([
	"SOCKET_PATH",
	"HOST",
	"PORT",
	"ORIGIN",
	"XFF_DEPTH",
	"ADDRESS_HEADER",
	"PROTOCOL_HEADER",
	"HOST_HEADER",
	"PORT_HEADER",
	"BODY_SIZE_LIMIT",
	"IDLE_TIMEOUT",
	"SHUTDOWN_TIMEOUT",
]);

if (ENV_PREFIX) {
	for (const name in Bun.env) {
		if (name.startsWith(ENV_PREFIX)) {
			const unprefixed = name.slice(ENV_PREFIX.length);
			if (!expected.has(unprefixed)) {
				throw new Error(
					`You should change envPrefix (${ENV_PREFIX}) to avoid conflicts with existing environment variables — unexpectedly saw ${name}`,
				);
			}
		}
	}
}

export function env(name: string, fallback: string): string;
export function env(name: string, fallback: false): string | false;
export function env(name: string, fallback?: undefined): string | undefined;
export function env(name: string, fallback?: string | false) {
	const prefixed = ENV_PREFIX + name;
	return prefixed in Bun.env ? Bun.env[prefixed] : fallback;
}
