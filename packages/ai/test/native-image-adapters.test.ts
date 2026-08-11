import { afterEach, describe, expect, it, vi } from "vitest";
import { generateImages as generateBailianImages } from "../src/api/dashscope-images.ts";
import { generateImages as generateVolcengineImages } from "../src/api/volcengine-images.ts";
import type { ImageContent, ImagesContext, ImagesModel } from "../src/types.ts";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function imageContent(data = "cmVmZXJlbmNl", mimeType = "image/png"): ImageContent {
	return { type: "image", data, mimeType };
}

function bailianModel(): ImagesModel<"dashscope-images"> {
	return {
		id: "wan2.7-image-pro",
		name: "Wan 2.7 Image Pro",
		api: "dashscope-images",
		provider: "bailian",
		baseUrl: "https://dashscope.aliyuncs.com",
		connection: { region: "cn-beijing", workspaceId: "ws-test" },
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: { supportsMaskEditing: false, supportsTransparentBackground: false },
	};
}

function volcengineModel(): ImagesModel<"volcengine-images"> {
	return {
		id: "doubao-seedream-5-0-pro-260628",
		name: "Seedream 5.0 Pro",
		api: "volcengine-images",
		provider: "volcengine",
		baseUrl: "https://ark.example.test",
		connection: { region: "cn-beijing" },
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: { supportsMaskEditing: false, supportsTransparentBackground: false },
	};
}

describe.sequential("native image adapters", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("posts a Wan request and materializes the temporary image URL", async () => {
		const requests: Request[] = [];
		const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
			const request = new Request(input as string | URL | Request, init);
			requests.push(request);
			if (request.method === "GET") {
				return new Response(Uint8Array.from([137, 80, 78, 71]), {
					status: 200,
					headers: { "Content-Type": "image/png" },
				});
			}
			return jsonResponse({
				request_id: "wan-request-1",
				output: {
					choices: [{ message: { content: [{ image: "https://cdn.example.test/temporary.png" }] } }],
				},
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const response = await generateBailianImages(
			bailianModel(),
			{
				input: [{ type: "text", text: "A red paper lantern" }],
				outputCount: 1,
				generation: { resolution: "2K", seed: 7, watermark: false },
			},
			{ apiKey: "bailian-key" },
		);

		expect(response.stopReason).toBe("stop");
		expect(response.responseId).toBe("wan-request-1");
		expect(response.output).toEqual([{ type: "image", mimeType: "image/png", data: "iVBORw==" }]);
		expect(requests).toHaveLength(2);
		expect(requests[0].url).toBe(
			"https://ws-test.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
		);
		expect(requests[0].headers.get("Authorization")).toBe("Bearer bailian-key");
		expect(requests[0].headers.get("X-DashScope-WorkSpace")).toBeNull();
		expect(await requests[0].json()).toMatchObject({
		model: "wan2.7-image-pro",
		input: { messages: [{ content: [{ text: "A red paper lantern" }] }] },
		parameters: { n: 1, size: "2K", seed: 7, watermark: false },
	});
	});

	it("sends DashScope reference images as inline data URLs", async () => {
		let requestBody: Record<string, unknown> | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
				const request = new Request(input as string | URL | Request, init);
				requestBody = (await request.json()) as Record<string, unknown>;
				return jsonResponse({ output: { choices: [{ message: { content: [{ image: "data:image/jpeg;base64,ZWQ=" }] } }] } });
			}),
		);

		const response = await generateBailianImages(
			bailianModel(),
			{ input: [{ type: "text", text: "Keep the pose" }, imageContent("aW1hZ2U=", "image/jpeg")] },
			{ apiKey: "bailian-key" },
		);

		expect(response.output).toEqual([{ type: "image", mimeType: "image/jpeg", data: "ZWQ=" }]);
			expect(requestBody).toMatchObject({
			input: {
				messages: [{ content: [{ text: "Keep the pose" }, { image: "data:image/jpeg;base64,aW1hZ2U=" }] }],
			},
		});
	});

	it("combines Bailian resolution tiers with the requested aspect ratio", async () => {
		let requestBody: Record<string, unknown> | undefined;
		vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
			const request = new Request(input as string | URL | Request, init);
			requestBody = await request.json() as Record<string, unknown>;
			return jsonResponse({ output: { choices: [{ message: { content: [{ image: "data:image/png;base64,d2Fu" }] } }] } });
		}));

		await generateBailianImages(
			bailianModel(),
			{ input: [{ type: "text", text: "A vertical poster" }], generation: { resolution: "2K", aspectRatio: "9:16" } },
			{ apiKey: "bailian-key" },
		);

		expect(requestBody).toMatchObject({ parameters: { size: "1536*2731" } });
	});

	it("uses Seedream generations for both text and reference-image input", async () => {
		const requests: Request[] = [];
		const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
			const request = new Request(input as string | URL | Request, init);
			requests.push(request);
			return jsonResponse({ id: "seedream-request-1", data: [{ b64_json: "c2VlZA==" }] });
		});
		vi.stubGlobal("fetch", fetchMock);

		const response = await generateVolcengineImages(
			volcengineModel(),
			{
				input: [{ type: "text", text: "A quiet mountain lake" }, imageContent()],
				generation: { size: "1024x1536", outputFormat: "webp", watermark: true },
			},
			{ apiKey: "volc-key" },
		);

		expect(response.stopReason).toBe("stop");
		expect(response.responseId).toBe("seedream-request-1");
		expect(response.output).toEqual([{ type: "image", mimeType: "image/webp", data: "c2VlZA==" }]);
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe("https://ark.example.test/api/v3/images/generations");
		expect(await requests[0].json()).toMatchObject({
		model: "doubao-seedream-5-0-pro-260628",
		prompt: "A quiet mountain lake",
		image: "data:image/png;base64,cmVmZXJlbmNl",
		response_format: "b64_json",
		sequential_image_generation: "disabled",
		size: "1024x1536",
		output_format: "webp",
		watermark: true,
	});
	});

	it("enables Seedream sequential output only when more than one image is requested", async () => {
		let requestBody: Record<string, unknown> | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
				const request = new Request(input as string | URL | Request, init);
				requestBody = (await request.json()) as Record<string, unknown>;
				return jsonResponse({ data: [{ b64_json: "b25l" }, { b64_json: "dHdv" }] });
			}),
		);

		const response = await generateVolcengineImages(
			{ ...volcengineModel(), id: "doubao-seedream-5-0-lite-260128" },
			{ input: [{ type: "text", text: "Two variations" }], outputCount: 2 },
			{ apiKey: "volc-key" },
		);

		expect(response.output).toHaveLength(2);
		expect(requestBody).toMatchObject({
			sequential_image_generation: "auto",
			sequential_image_generation_options: { max_images: 2 },
		});
	});

	it("keeps Seedream 3K output and applies the selected ratio", async () => {
		let requestBody: Record<string, unknown> | undefined;
		vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
			const request = new Request(input as string | URL | Request, init);
			requestBody = await request.json() as Record<string, unknown>;
			return jsonResponse({ data: [{ b64_json: "M2s=" }] });
		}));

		await generateVolcengineImages(
			{ ...volcengineModel(), id: "doubao-seedream-5-0-lite-260128" },
			{ input: [{ type: "text", text: "A wide banner" }], generation: { resolution: "3K", aspectRatio: "16:9" } },
			{ apiKey: "volc-key" },
		);

		expect(requestBody).toMatchObject({ size: "4096x2304" });
	});

	it("uses the documented Seedream Pro 2K dimensions", async () => {
		let requestBody: Record<string, unknown> | undefined;
		vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
			requestBody = await new Request(input as string | URL | Request, init).json() as Record<string, unknown>;
			return jsonResponse({ data: [{ b64_json: "cHJv" }] });
		}));

		await generateVolcengineImages(
			volcengineModel(),
			{ input: [{ type: "text", text: "A cinematic banner" }], generation: { resolution: "2K", aspectRatio: "21:9" } },
			{ apiKey: "volc-key" },
		);

		expect(requestBody).toMatchObject({ size: "3136x1344" });
	});

	it("returns a clear error for unsupported mask editing", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const response = await generateVolcengineImages(
			volcengineModel(),
			{ input: [{ type: "text", text: "Edit" }, imageContent()], edit: { mask: imageContent("bWFzaw==") } },
			{ apiKey: "volc-key" },
		);
		expect(response.stopReason).toBe("error");
		expect(response.errorMessage).toContain("does not support raster mask editing");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
