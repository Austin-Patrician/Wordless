import { volcengineImagesApi } from "../api/volcengine-images.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createImagesProvider, type ImagesProvider } from "../images-models.ts";
import type { ImageOutputFormat, ImagesModel } from "../types.ts";

const SEEDREAM_BASE_CAPABILITIES = {
	supportsTextToImage: true,
	supportsReferenceImageEditing: true,
	supportsMaskEditing: false,
	supportsTransparentBackground: false,
	supportsSpatialAnnotation: true,
	maxReferenceImages: 14,
	maxOutputImages: 4,
	aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16"],
	resolutions: ["2K", "3K", "4K"],
	outputFormats: ["png", "jpeg"] as ImageOutputFormat[],
	supportsWatermark: true,
};

const SEEDREAM_PRO_CAPABILITIES = {
	...SEEDREAM_BASE_CAPABILITIES,
	maxReferenceImages: 10,
	maxOutputImages: 1,
	resolutions: ["1K", "2K"],
};

export const VOLCENGINE_IMAGE_MODELS: readonly ImagesModel<"volcengine-images">[] = [
	{
		id: "doubao-seedream-5-0-pro-260628",
		name: "Seedream 5.0 Pro",
		api: "volcengine-images",
		provider: "volcengine",
		baseUrl: "https://ark.cn-beijing.volces.com",
		connection: { region: "cn-beijing" },
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: SEEDREAM_PRO_CAPABILITIES,
	},
	{
		id: "doubao-seedream-5-0-lite-260128",
		name: "Seedream 5.0 Lite",
		api: "volcengine-images",
		provider: "volcengine",
		baseUrl: "https://ark.cn-beijing.volces.com",
		connection: { region: "cn-beijing" },
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: SEEDREAM_BASE_CAPABILITIES,
	},
];

export function volcengineImagesProvider(): ImagesProvider {
	return createImagesProvider({
		id: "volcengine",
		name: "Volcengine Seedream",
		auth: { apiKey: envApiKeyAuth("Volcengine API key", ["VOLCENGINE_API_KEY", "ARK_API_KEY"]) },
		models: VOLCENGINE_IMAGE_MODELS,
		api: volcengineImagesApi(),
	});
}

/** Alias for callers that use the model-family name. */
export const seedreamImagesProvider = volcengineImagesProvider;
