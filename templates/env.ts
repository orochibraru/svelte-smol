import { env_prefix } from "MANIFEST";
import process from "node:process";

const expected = new Set([
	"SOCKET_PATH",
	"HOST",
	"PORT",
	"REUSE_PORT",
	"IPV6_ONLY",
	"CONNECTION_IDLE_TIMEOUT",
	"BODY_SIZE_LIMIT",
	"SHUTDOWN_TIMEOUT",
	"DEVELOPMENT",
	"XFF_DEPTH",
	"ADDRESS_HEADER",
	"PROTOCOL_HEADER",
	"HOST_HEADER",
	"PORT_HEADER",
	"HEALTHCHECK_PATH",
	"HEALTHCHECK_TIMEOUT",
]);

if (env_prefix) {
	for (const name in process.env) {
		if (
			name.startsWith(env_prefix) &&
			!expected.has(name.slice(env_prefix.length))
		) {
			throw new Error(
				`You should change envPrefix (${env_prefix}) to avoid conflicts with existing environment variables — unexpectedly saw ${name}`,
			);
		}
	}
}

function parsing_error(name: string, value: string, expected: string): never {
	throw new Error(
		`Invalid value for environment variable ${env_prefix + name}: ${JSON.stringify(value)} (expected ${expected})`,
	);
}

export function env<T extends string | undefined = undefined>(
	name: string,
	fallback?: T,
): string | T {
	const prefixed = env_prefix + name;
	return prefixed in process.env
		? (process.env[prefixed] as string)
		: (fallback as T);
}

const BOOLEANS: Record<string, boolean> = {
	1: true,
	true: true,
	yes: true,
	on: true,
	0: false,
	false: false,
	no: false,
	off: false,
};

export function boolean_env<T extends boolean | undefined = undefined>(
	name: string,
	fallback?: T,
): boolean | T {
	const value = env(name);
	if (value === undefined) return fallback as T;
	return (
		BOOLEANS[value.toLowerCase()] ?? parsing_error(name, value, "a boolean")
	);
}

export function number_env<T extends number | undefined = undefined>(
	name: string,
	fallback?: T,
	limits: { min?: number; max?: number } = {},
): number | T {
	const value = env(name);
	if (value === undefined) return fallback as T;
	if (!/^\d+$/.test(value)) {
		parsing_error(name, value, "a non-negative integer");
	}

	const number = Number(value);
	if (
		!Number.isSafeInteger(number) ||
		number < (limits.min ?? 0) ||
		number > (limits.max ?? Number.POSITIVE_INFINITY)
	) {
		const range =
			limits.max === undefined
				? `at least ${limits.min ?? 0}`
				: `between ${limits.min ?? 0} and ${limits.max}`;
		parsing_error(name, value, `an integer ${range}`);
	}

	return number;
}

export function bytes_env<T extends number | undefined = undefined>(
	name: string,
	fallback?: T,
): number | T {
	const value = env(name);
	if (value === undefined) return fallback as T;
	// adapter-node documents Infinity as the value that disables the limit
	if (value === "Infinity") return Number.POSITIVE_INFINITY;
	if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[KMG])?$/i.test(value)) {
		parsing_error(
			name,
			value,
			"a non-negative number with an optional K, M, or G suffix, or Infinity",
		);
	}

	const suffix = value.at(-1)?.toUpperCase() as string;
	const multiplier =
		(
			{ K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024 } as Record<
				string,
				number
			>
		)[suffix] ?? 1;
	const number =
		Number(multiplier === 1 ? value : value.slice(0, -1)) * multiplier;

	if (!Number.isSafeInteger(number)) {
		parsing_error(name, value, "a non-negative number of whole bytes");
	}

	return number;
}
