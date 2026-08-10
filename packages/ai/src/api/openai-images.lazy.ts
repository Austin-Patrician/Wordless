import type { ImagesModel, ProviderImages } from "../types.ts";

/** Keeps the OpenAI SDK out of the model catalog's startup path. */
export const openaiImagesApi = (): ProviderImages => ({
	generateImages: async (model, context, options) =>
		(await import("./openai-images.ts")).generateImages(
			model as ImagesModel<"openai-images">,
			context,
			options,
		),
});
