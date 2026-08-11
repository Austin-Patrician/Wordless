import { afterEach, describe, expect, it, vi } from "vitest";
import { generateImages } from "../src/api/openai-images.ts";
import { openaiImagesProvider } from "../src/providers/openai-images.ts";
import type { ImageContent, ImagesContext, ImagesModel } from "../src/types.ts";

function createModel(id = "gpt-image-1.5"): ImagesModel<"openai-images"> {
	return {
		id,
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

	it("advertises the documented GPT Image aspect ratios", () => {
		const model = openaiImagesProvider().getModels().find((item) => item.id === "gpt-image-2");
		expect(model?.capabilities?.aspectRatios).toEqual(["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "auto"]);
		expect(openaiImagesProvider().getModels().find((item) => item.id === "gpt-image-1.5")?.capabilities?.aspectRatios)
			.toEqual(["1:1", "3:2", "2:3", "auto"]);
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
		});
	});

	it("maps canonical generation controls to native OpenAI fields", async () => {
		const requests: Request[] = [];
		vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit): Promise<Response> => {
			const request = new Request(input as string | URL | Request, init);
			requests.push(request);
			return jsonResponse({ created: 1, output_format: "webp", data: [{ b64_json: "d2VicA==" }] });
		});

		const response = await generateImages(
			createModel(),
			{
				input: [{ type: "text", text: "A landscape illustration" }],
				outputCount: 2,
				generation: {
					aspectRatio: "16:9",
					quality: "high",
					outputFormat: "webp",
					outputCompression: 72,
				},
			},
			{ apiKey: "test-key" },
		);

		expect(response.stopReason).toBe("stop");
		expect(response.output).toEqual([{ type: "image", mimeType: "image/webp", data: "d2VicA==" }]);
		expect(await requests[0]?.json()).toMatchObject({
			model: "gpt-image-1.5",
			prompt: "A landscape illustration",
			n: 2,
			size: "1536x1024",
			quality: "high",
			output_format: "webp",
			output_compression: 72,
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

	it("sends high input fidelity for GPT Image 2 masked edits", async () => {
		const requests: Request[] = [];
		vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit): Promise<Response> => {
			const request = new Request(input as string | URL | Request, init);
			if (request.url !== "data:,") requests.push(request);
			return jsonResponse({ created: 1, data: [{ b64_json: "ZWRpdGVk" }] });
		});

		const response = await generateImages(
			createModel("gpt-image-2"),
			{
				input: [{ type: "text", text: "Remove only the masked garment" }, imageContent("cmVm")],
				edit: { mask: imageContent("bWFzaw=="), inputFidelity: "high" },
			},
			{ apiKey: "test-key" },
		);

		expect(response.stopReason).toBe("stop");
		const form = await requests[0].formData();
		expect(form.get("model")).toBe("gpt-image-2");
		expect(form.get("input_fidelity")).toBe("high");
	});

	it("maps generation controls on edit requests", async () => {
		const requests: Request[] = [];
		vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit): Promise<Response> => {
			const request = new Request(input as string | URL | Request, init);
			if (request.url !== "data:,") requests.push(request);
			return jsonResponse({ created: 1, output_format: "jpeg", data: [{ b64_json: "ZWRpdA==" }] });
		});

		const response = await generateImages(
			createModel(),
			{
				input: [
					{ type: "text", text: "Make the subject cinematic" },
					imageContent("cmVmZXJlbmNl"),
				],
				generation: { size: "1024x1024", quality: "medium", outputFormat: "jpeg" },
			},
			{ apiKey: "test-key" },
		);

		expect(response.stopReason).toBe("stop");
		expect(response.output[0]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
		expect(requests).toHaveLength(1);
		const form = await requests[0]!.formData();
		expect(form.get("size")).toBe("1024x1024");
		expect(form.get("quality")).toBe("medium");
		expect(form.get("output_format")).toBe("jpeg");
	});

	it("maps GPT Image 2 resolution tiers to valid flexible dimensions", async () => {
		const requests: Request[] = [];
		vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit): Promise<Response> => {
			const request = new Request(input as string | URL | Request, init);
			requests.push(request);
			return jsonResponse({ created: 1, data: [{ b64_json: "MmstaW1hZ2U=" }] });
		});

		const model = { ...createModel(), id: "gpt-image-2" };
		const response = await generateImages(model, {
			input: [{ type: "text", text: "A wide editorial photograph" }],
			generation: { resolution: "2K", aspectRatio: "16:9" },
		}, { apiKey: "test-key" });

		expect(response.stopReason).toBe("stop");
		const body = await requests[0]?.json() as { size?: string };
		expect(body.size).toMatch(/^\d+x\d+$/);
		const [width, height] = body.size!.split("x").map(Number);
		expect(width % 16).toBe(0);
		expect(height % 16).toBe(0);
		expect(width / height).toBeCloseTo(16 / 9, 1);
	});

	it("forwards automatic sizing for GPT Image models", async () => {
		const requests: Request[] = [];
		vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit): Promise<Response> => {
			const request = new Request(input as string | URL | Request, init);
			requests.push(request);
			return jsonResponse({ created: 1, data: [{ b64_json: "YXV0bw==" }] });
		});

		await generateImages(
			{ ...createModel(), id: "gpt-image-2" },
			{ input: [{ type: "text", text: "Choose the best composition" }], generation: { aspectRatio: "auto" } },
			{ apiKey: "test-key" },
		);

		expect(await requests[0]?.json()).toMatchObject({ size: "auto" });
	});
});
