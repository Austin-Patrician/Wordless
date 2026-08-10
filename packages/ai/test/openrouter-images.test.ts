import { afterEach, describe, expect, it, vi } from "vitest";
import { generateImages } from "../src/api/openrouter-images.ts";
import type { ImageContent, ImagesModel } from "../src/types.ts";

function createModel(): ImagesModel<"openrouter-images"> {
	return {
		id: "openai/gpt-image-2",
		name: "OpenAI: GPT Image 2",
		api: "openrouter-images",
		provider: "openrouter",
		baseUrl: "https://openrouter.ai/api/v1",
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0.015, output: 0.03, cacheRead: 0, cacheWrite: 0 },
		headers: { "HTTP-Referer": "https://example.com" },
	};
}

function image(data = "cmVmZXJlbmNl"): ImageContent {
	return { type: "image", mimeType: "image/png", data };
}

describe.sequential("OpenRouter Images adapter", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("uses the dedicated Images API and maps neutral generation controls", async () => {
		const requests: Request[] = [];
		vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
			requests.push(new Request(input as string | URL | Request, init));
			return new Response(JSON.stringify({
				id: "img-1",
				data: [{ b64_json: "ZmFrZS1wbmc=", media_type: "image/png" }],
				usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46, cost: 0.04 },
			}), { status: 200, headers: { "Content-Type": "application/json" } });
		}));

		const output = await generateImages(createModel(), {
			input: [{ type: "text", text: "Generate a dog" }, image()],
			outputCount: 2,
			generation: {
				resolution: "2K",
				aspectRatio: "16:9",
				quality: "high",
				outputFormat: "png",
				seed: 42,
			},
		}, { apiKey: "test" });

		expect(output.stopReason).toBe("stop");
		expect(output.responseId).toBe("img-1");
		expect(output.output).toEqual([{ type: "image", mimeType: "image/png", data: "ZmFrZS1wbmc=" }]);
		expect(output.usage?.cost.total).toBe(0.04);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe("https://openrouter.ai/api/v1/images");
		expect(requests[0]?.headers.get("Authorization")).toBe("Bearer test");
		expect(requests[0]?.headers.get("HTTP-Referer")).toBe("https://example.com");
		expect(await requests[0]?.json()).toEqual({
			model: "openai/gpt-image-2",
			prompt: "Generate a dog",
			n: 2,
			resolution: "2K",
			aspect_ratio: "16:9",
			quality: "high",
			output_format: "png",
			seed: 42,
			input_references: [{
				type: "image_url",
				image_url: { url: "data:image/png;base64,cmVmZXJlbmNl" },
			}],
		});
	});

	it("passes through abort signals and returns an aborted result", async () => {
		vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
			if (init?.signal?.aborted) throw new Error("Request aborted");
			return new Response();
		}));
		const controller = new AbortController();
		controller.abort();

		const output = await generateImages(createModel(), {
			input: [{ type: "text", text: "Generate a dog" }],
		}, { apiKey: "test", signal: controller.signal });

		expect(output.stopReason).toBe("aborted");
		expect(output.errorMessage).toBe("Request aborted");
	});

	it("rejects raster masks before sending a request", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const output = await generateImages(createModel(), {
			input: [{ type: "text", text: "Replace the object" }, image()],
			edit: { mask: image("bWFzaw==") },
		}, { apiKey: "test" });

		expect(output.stopReason).toBe("error");
		expect(output.errorMessage).toContain("does not support raster mask editing");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
