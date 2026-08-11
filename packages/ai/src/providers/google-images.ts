import { googleInteractionsImagesApi } from "../api/google-interactions-images.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createImagesProvider, type ImagesProvider } from "../images-models.ts";
import type { ImagesModel } from "../types.ts";

const GOOGLE_IMAGE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const GOOGLE_IMAGE_MODELS: readonly ImagesModel<"google-interactions-images">[] = [
	{
		id: "gemini-3.1-flash-lite-image",
		name: "Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)",
		api: "google-interactions-images",
		provider: "google",
		baseUrl: GOOGLE_IMAGE_BASE_URL,
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: {
			supportsTextToImage: true,
			supportsReferenceImageEditing: true,
			supportsMaskEditing: false,
			supportsTransparentBackground: false,
			maxReferenceImages: 3,
			maxOutputImages: 1,
			aspectRatios: ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"],
			resolutions: ["1K"],
			outputFormats: ["png", "jpeg"],
			qualityLevels: ["auto"],
		},
	},
	{
		id: "gemini-3.1-flash-image",
		name: "Nano Banana 2 (Gemini 3.1 Flash Image)",
		api: "google-interactions-images",
		provider: "google",
		baseUrl: GOOGLE_IMAGE_BASE_URL,
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: {
			supportsTextToImage: true,
			supportsReferenceImageEditing: true,
			supportsMaskEditing: false,
			supportsTransparentBackground: false,
			maxReferenceImages: 14,
			maxOutputImages: 1,
			aspectRatios: ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"],
			resolutions: ["0.5K", "1K", "2K", "4K"],
			outputFormats: ["png", "jpeg"],
			qualityLevels: ["auto"],
		},
	},
	{
		id: "gemini-3-pro-image",
		name: "Nano Banana Pro (Gemini 3 Pro Image)",
		api: "google-interactions-images",
		provider: "google",
		baseUrl: GOOGLE_IMAGE_BASE_URL,
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: {
			supportsTextToImage: true,
			supportsReferenceImageEditing: true,
			supportsMaskEditing: false,
			supportsTransparentBackground: false,
			maxReferenceImages: 14,
			maxOutputImages: 1,
			aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
			resolutions: ["1K", "2K", "4K"],
			outputFormats: ["png", "jpeg"],
			qualityLevels: ["auto"],
		},
	},
	{
		id: "gemini-2.5-flash-image",
		name: "Nano Banana (Gemini 2.5 Flash Image)",
		api: "google-interactions-images",
		provider: "google",
		baseUrl: GOOGLE_IMAGE_BASE_URL,
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: {
			supportsTextToImage: true,
			supportsReferenceImageEditing: true,
			supportsMaskEditing: false,
			supportsTransparentBackground: false,
			maxReferenceImages: 3,
			maxOutputImages: 1,
			aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
			resolutions: ["1K"],
			outputFormats: ["png", "jpeg"],
			qualityLevels: ["auto"],
		},
	},
];

export function googleImagesProvider(): ImagesProvider {
	return createImagesProvider({
		id: "google",
		name: "Google",
		auth: { apiKey: envApiKeyAuth("Gemini API key", ["GEMINI_API_KEY", "GOOGLE_API_KEY"]) },
		models: GOOGLE_IMAGE_MODELS,
		api: googleInteractionsImagesApi(),
	});
}

export { GOOGLE_IMAGE_MODELS };
