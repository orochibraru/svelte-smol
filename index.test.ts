import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Builder } from "@sveltejs/kit";
import adapter, { type AdapterOptions } from "./index";

// Throws on the first property read, so each test sees how far adapt() got.
function fake_builder(kit: 2 | 3) {
	return new Proxy({} as Builder, {
		has: (_, key) => kit === 3 && key === "generateServerInstance",
		get: (_, key) => {
			throw new Error(`builder.${String(key)} read`);
		},
	});
}

async function adapt(kit: 2 | 3, options?: AdapterOptions) {
	return adapter(options).adapt(fake_builder(kit));
}

test("returns a SvelteKit adapter with supported features", () => {
	const result = adapter();
	expect(result.name).toBe("@orochibraru/svelte-smol");
	expect(result.supports?.read?.({ config: {}, route: { id: "/" } })).toBe(
		true,
	);
	expect(result.supports?.instrumentation?.()).toBe(true);
});

test("runs the SvelteKit 2 adapter on a SvelteKit 2 builder", async () => {
	await expect(adapt(2)).rejects.toThrow("builder.config read");
});

test("runs the SvelteKit 3 adapter on a SvelteKit 3 builder", async () => {
	const out = join(mkdtempSync(join(tmpdir(), "svelte-smol-")), "build");
	await expect(adapt(3, { out })).rejects.toThrow("builder.log read");
});

test("rejects SvelteKit 3 options on SvelteKit 2", async () => {
	await expect(
		adapt(2, { buildOptions: {}, serverOptions: {} }),
	).rejects.toThrow(
		"svelte-smol: buildOptions, serverOptions not supported with SvelteKit 2",
	);
});

test("rejects SvelteKit 2 options on SvelteKit 3", async () => {
	await expect(adapt(3, { compile: false })).rejects.toThrow(
		"svelte-smol: compile not supported with SvelteKit 3",
	);
});
