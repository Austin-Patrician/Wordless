import { openaiImagesApi } from "../api/openai-images.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createImagesProvider, type ImagesProvider } from "../images-models.ts";
import type { ImagesModel } from "../types.ts";

const OPENAI_IMAGE_MODELS: readonly ImagesModel<"openai-images">[] = [
	/**
	 * GPT Image 2.5 (2026-09-08) ships as two API models rather than one:
	 * `flare` is the fast everyday tier and `sunburst` the quality tier.
	 * Both take the same request, so the entries below differ only by id/name.
	 *
	 * Versus GPT Image 2 they add `xhigh`/`max` quality and documented
	 * transparent-background support, and they are the models the current
	 * OpenAI image guides describe. Sizes and reference limits are unchanged.
	 */
	{
		id: "gpt-image-2.5-flare",
		name: "GPT Image 2.5 Flare",
		api: "openai-images",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: {
			supportsTextToImage: true,
			supportsReferenceImageEditing: true,
			supportsMaskEditing: true,
			supportsTransparentBackground: true,
			maxReferenceImages: 16,
			maxOutputImages: 10,
			aspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "auto"],
			resolutions: ["1K", "2K", "4K"],
			outputFormats: ["png", "jpeg", "webp"],
			qualityLevels: ["auto", "low", "medium", "high", "xhigh", "max"],
		},
	},
	{
		id: "gpt-image-2.5-sunburst",
		name: "GPT Image 2.5 Sunburst",
		api: "openai-images",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: {
			supportsTextToImage: true,
			supportsReferenceImageEditing: true,
			supportsMaskEditing: true,
			supportsTransparentBackground: true,
			maxReferenceImages: 16,
			maxOutputImages: 10,
			aspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "auto"],
			resolutions: ["1K", "2K", "4K"],
			outputFormats: ["png", "jpeg", "webp"],
			qualityLevels: ["auto", "low", "medium", "high", "xhigh", "max"],
		},
	},
	{
		id: "gpt-image-2",
		name: "GPT Image 2",
		api: "openai-images",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: {
			supportsTextToImage: true,
			supportsReferenceImageEditing: true,
			supportsMaskEditing: true,
			supportsTransparentBackground: false,
			maxReferenceImages: 16,
			maxOutputImages: 10,
			aspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "auto"],
				resolutions: ["1K", "2K", "4K"],
			outputFormats: ["png", "jpeg", "webp"],
			qualityLevels: ["auto", "low", "medium", "high"],
		},
	},
	{
		id: "gpt-image-1.5",
		name: "GPT Image 1.5",
		api: "openai-images",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: {
			supportsTextToImage: true,
			supportsReferenceImageEditing: true,
			supportsMaskEditing: true,
			supportsTransparentBackground: true,
			maxReferenceImages: 16,
			maxOutputImages: 10,
			aspectRatios: ["1:1", "3:2", "2:3", "auto"],
				resolutions: ["1K"],
			outputFormats: ["png", "jpeg", "webp"],
			qualityLevels: ["auto", "low", "medium", "high"],
		},
	},
	{
		id: "gpt-image-1",
		name: "GPT Image 1",
		api: "openai-images",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: {
			supportsTextToImage: true,
			supportsReferenceImageEditing: true,
			supportsMaskEditing: true,
			supportsTransparentBackground: true,
			maxReferenceImages: 16,
			maxOutputImages: 10,
			aspectRatios: ["1:1", "3:2", "2:3", "auto"],
				resolutions: ["1K"],
			outputFormats: ["png", "jpeg", "webp"],
			qualityLevels: ["auto", "low", "medium", "high"],
		},
	},
	{
		id: "gpt-image-1-mini",
		name: "GPT Image 1 mini",
		api: "openai-images",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: {
			supportsTextToImage: true,
			supportsReferenceImageEditing: true,
			supportsMaskEditing: true,
			supportsTransparentBackground: true,
			maxReferenceImages: 16,
			maxOutputImages: 10,
			aspectRatios: ["1:1", "3:2", "2:3", "auto"],
			resolutions: ["1K"],
			outputFormats: ["png", "jpeg", "webp"],
			qualityLevels: ["auto", "low", "medium", "high"],
		},
	},
];

export function openaiImagesProvider(): ImagesProvider {
	return createImagesProvider({
		id: "openai",
		name: "OpenAI Images",
		auth: { apiKey: envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]) },
		models: OPENAI_IMAGE_MODELS,
		api: openaiImagesApi(),
	});
}
