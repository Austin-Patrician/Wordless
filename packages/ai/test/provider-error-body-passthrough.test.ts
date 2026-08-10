// Regression test for issues/provider-error-body-passthrough
//
// When an endpoint behind a proxy / gateway returns a non-2xx response with a
// structured body, the provider catch block must preserve both the HTTP status
// and the gateway's reason instead of surfacing an opaque request error.
//
// OpenRouter images uses its native `/images` endpoint, so this test exercises
// the same fetch response shape used by the production adapter.

import { afterEach, describe, expect, it, vi } from "vitest";
import { generateImages } from "../src/images.ts";
import type { ImagesContext, ImagesModel } from "../src/types.ts";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("provider error body passthrough", () => {
	it("surfaces the HTTP body reason instead of the opaque SDK message (openrouter images)", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(
			JSON.stringify({ error: "blocked by gateway WAF" }),
			{ status: 403, headers: { "content-type": "application/json" } },
		)));
		const model: ImagesModel<"openrouter-images"> = {
			id: "black-forest-labs/flux.2-pro",
			name: "FLUX.2 Pro",
			api: "openrouter-images",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			input: ["text", "image"],
			output: ["image"],
			cost: { input: 0.015, output: 0.03, cacheRead: 0, cacheWrite: 0 },
		};
		const context: ImagesContext = {
			input: [{ type: "text", text: "Generate a dog" }],
		};

		const output = await generateImages(model, context, { apiKey: "test" });

		expect(output.stopReason).toBe("error");
		// The status should be surfaced.
		expect(output.errorMessage).toContain("403");
		// The body reason must not be swallowed by the opaque SDK message.
		expect(output.errorMessage).toContain("blocked by gateway WAF");
		expect(output.errorMessage).not.toBe("403 status code (no body)");
	});
});
