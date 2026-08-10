import { afterEach, describe, expect, it, vi } from "vitest";
import { generateImages } from "../src/api/google-interactions-images.ts";
import type { ImagesContext, ImagesModel } from "../src/types.ts";

function createModel(): ImagesModel<"google-interactions-images"> {
	return {
		id: "gemini-3.1-flash-image",
		name: "Nano Banana 2",
		api: "google-interactions-images",
		provider: "google",
		baseUrl: "https://generativelanguage.googleapis.com/v1beta",
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
		capabilities: {
			supportsTextToImage: true,
			supportsReferenceImageEditing: true,
			supportsMaskEditing: false,
			supportsTransparentBackground: false,
			maxReferenceImages: 14,
			maxOutputImages: 1,
		},
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", "X-Request-ID": "request-1" },
	});
}

describe.sequential("Google Interactions image adapter", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("sends a native Interactions request and parses output_image", async () => {
		const requests: Request[] = [];
		vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
			requests.push(new Request(input as string | URL | Request, init));
			return jsonResponse({
				id: "interaction-1",
				output_image: { type: "image", mime_type: "image/jpeg", data: "amVwZw==" },
				usage: { input_tokens: 10, output_tokens: 20 },
			});
		}));

		const context: ImagesContext = {
			input: [{ type: "text", text: "A clean editorial product photograph" }],
			generation: { aspectRatio: "16:9", resolution: "2K", outputFormat: "jpeg" },
		};
		const response = await generateImages(createModel(), context, { apiKey: "gemini-key" });

		expect(response.stopReason).toBe("stop");
		expect(response.responseId).toBe("interaction-1");
		expect(response.output).toEqual([{ type: "image", mimeType: "image/jpeg", data: "amVwZw==" }]);
		expect(response.usage).toMatchObject({ input: 10, output: 20, totalTokens: 30 });
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
		expect(requests[0]?.headers.get("x-goog-api-key")).toBe("gemini-key");
		expect(await requests[0]?.json()).toMatchObject({
			model: "gemini-3.1-flash-image",
			store: false,
			input: [{ type: "text", text: "A clean editorial product photograph" }],
			response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "16:9", image_size: "2K" },
		});
	});

	it("passes reference images as inline base64 input", async () => {
		let requestBody: unknown;
		vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
			requestBody = await new Request(input as string | URL | Request, init).json();
			return jsonResponse({ output_image: { data: "ZWRpdA==", mime_type: "image/png" } });
		}));

		const context: ImagesContext = {
			input: [
				{ type: "image", mimeType: "image/png", data: "cmVm" },
				{ type: "text", text: "Turn this into a watercolor illustration" },
			],
		};
		const response = await generateImages(createModel(), context, { apiKey: "gemini-key" });

		expect(response.stopReason).toBe("stop");
		expect(response.output).toContainEqual({ type: "image", mimeType: "image/png", data: "ZWRpdA==" });
		expect(requestBody).toMatchObject({
			input: [
				{ type: "image", mime_type: "image/png", data: "cmVm" },
				{ type: "text", text: "Turn this into a watercolor illustration" },
			],
		});
	});

	it("returns a useful provider error for unsupported mask editing", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const context: ImagesContext = {
			input: [
				{ type: "text", text: "Edit the selected area" },
				{ type: "image", mimeType: "image/png", data: "cmVm" },
			],
			edit: { mask: { type: "image", mimeType: "image/png", data: "bWFzaw==" } },
		};

		const response = await generateImages(createModel(), context, { apiKey: "gemini-key" });
		expect(response.stopReason).toBe("error");
		expect(response.errorMessage).toContain("does not support raster mask editing");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
