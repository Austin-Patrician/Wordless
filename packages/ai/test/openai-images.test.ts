import { afterEach, describe, expect, it, vi } from "vitest";
import { generateImages } from "../src/api/openai-images.ts";
import type { ImageContent, ImagesContext, ImagesModel } from "../src/types.ts";

function createModel(): ImagesModel<"openai-images"> {
	return {
		id: "gpt-image-1.5",
		name: "GPT Image 1.5",
		api: "openai-images",
		provider: "openai",
		baseUrl: "https://images.example.test/v1",
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: { supportsMaskEditing: true, supportsTransparentBackground: true },
	};
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function imageContent(data: string, mimeType = "image/png"): ImageContent {
	return { type: "image", data, mimeType };
}

describe.sequential("OpenAI Images adapter", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("sends a generation request with the requested output count", async () => {
		const requests: Request[] = [];
		const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
			const request = new Request(input as string | URL | Request, init);
			requests.push(request);
			return jsonResponse({ created: 1, data: [{ b64_json: "ZmFrZS1pbWFnZQ==" }] });
		});
		vi.stubGlobal("fetch", fetchMock);

		const response = await generateImages(
			createModel(),
			{ input: [{ type: "text", text: "A clean product photograph" }], outputCount: 3 },
			{ apiKey: "test-key" },
		);

		expect(response.stopReason).toBe("stop");
		expect(response.output).toEqual([{ type: "image", mimeType: "image/png", data: "ZmFrZS1pbWFnZQ==" }]);
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe("https://images.example.test/v1/images/generations");
		expect(await requests[0].json()).toMatchObject({
		model: "gpt-image-1.5",
		prompt: "A clean product photograph",
		n: 3,
		response_format: "b64_json",
	});
	});

	it("sends references and edit controls as multipart form data", async () => {
		const requests: Request[] = [];
		const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
			const request = new Request(input as string | URL | Request, init);
			if (request.url !== "data:,") requests.push(request);
			return jsonResponse({ created: 1, data: [{ b64_json: "ZWRpdGVkLWltYWdl" }] });
		});
		vi.stubGlobal("fetch", fetchMock);

		const reference = imageContent("cmVmZXJlbmNl");
		const mask = imageContent("bWFzaw==");
		const context: ImagesContext = {
			input: [{ type: "text", text: "Replace the background with a studio set" }, reference],
			edit: { mask, background: "transparent", inputFidelity: "high" },
			outputCount: 2,
		};

		const response = await generateImages(createModel(), context, { apiKey: "test-key" });

		expect(response.stopReason).toBe("stop");
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe("https://images.example.test/v1/images/edits");
		const form = await requests[0].formData();
		expect(form.get("model")).toBe("gpt-image-1.5");
		expect(form.get("prompt")).toBe("Replace the background with a studio set");
		expect(form.get("n")).toBe("2");
		expect(form.get("background")).toBe("transparent");
		expect(form.get("input_fidelity")).toBe("high");
		expect(form.get("image[]")).toBeInstanceOf(Blob);
		expect(form.get("mask")).toBeInstanceOf(Blob);
	});
});
