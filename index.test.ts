import { expect, test } from "bun:test";
import adapter from "./index";

test("returns a SvelteKit adapter", () => {
	const result = adapter();
	expect(result.name).toBe("homerun-svelte-adapter-bun");
	expect(typeof result.adapt).toBe("function");
});

test("reports supported features", () => {
	const result = adapter();
	expect(typeof result.supports?.read).toBe("function");
	expect(typeof result.supports?.instrumentation).toBe("function");
});

test("accepts options without throwing", () => {
	expect(() =>
		adapter({ out: "dist", precompress: true, envPrefix: "MYAPP_" }),
	).not.toThrow();
});
