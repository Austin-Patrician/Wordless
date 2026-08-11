import { dashscopeImagesApi } from "../api/dashscope-images.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createImagesProvider, type ImagesProvider } from "../images-models.ts";
import type { ImageOutputFormat, ImagesModel } from "../types.ts";

const BAILIAN_IMAGE_CAPABILITIES = {
	supportsTextToImage: true,
	supportsReferenceImageEditing: true,
	supportsMaskEditing: false,
	supportsTransparentBackground: false,
	supportsSpatialAnnotation: true,
	maxReferenceImages: 9,
	maxOutputImages: 4,
	aspectRatios: ["1:8", "1:4", "1:2", "2:3", "3:4", "9:16", "1:1", "16:9", "4:3", "3:2", "2:1", "4:1", "8:1"],
	resolutions: ["1K", "2K"],
	outputFormats: ["png"] as ImageOutputFormat[],
	supportsSeed: true,
	supportsWatermark: true,
};

const BAILIAN_IMAGE_PRO_CAPABILITIES = {
	...BAILIAN_IMAGE_CAPABILITIES,
	resolutions: ["1K", "2K", "4K"],
};

export const BAILIAN_IMAGE_MODELS: readonly ImagesModel<"dashscope-images">[] = [
	{
		id: "wan2.7-image-pro",
		name: "Wan 2.7 Image Pro",
		api: "dashscope-images",
		provider: "bailian",
		baseUrl: "https://dashscope.aliyuncs.com",
		connection: { region: "cn-beijing" },
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: BAILIAN_IMAGE_PRO_CAPABILITIES,
	},
	{
		id: "wan2.7-image",
		name: "Wan 2.7 Image",
		api: "dashscope-images",
		provider: "bailian",
		baseUrl: "https://dashscope.aliyuncs.com",
		connection: { region: "cn-beijing" },
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		capabilities: BAILIAN_IMAGE_CAPABILITIES,
	},
];

export function bailianImagesProvider(): ImagesProvider {
	return createImagesProvider({
		id: "bailian",
		name: "Alibaba Cloud Bailian",
		auth: { apiKey: envApiKeyAuth("Bailian API key", ["DASHSCOPE_API_KEY", "BAILIAN_API_KEY"]) },
		models: BAILIAN_IMAGE_MODELS,
		api: dashscopeImagesApi(),
	});
}

/** Protocol-oriented alias used by integrations that call the service DashScope. */
export const dashscopeImagesProvider = bailianImagesProvider;
