import { describe, expect, it } from "vitest";
import { IMAGE_MODELS } from "../src/image-models.generated.ts";
import { BAILIAN_IMAGE_MODELS } from "../src/providers/bailian-images.ts";
import { GOOGLE_IMAGE_MODELS } from "../src/providers/google-images.ts";
import { openaiImagesProvider } from "../src/providers/openai-images.ts";
import { VOLCENGINE_IMAGE_MODELS } from "../src/providers/volcengine-images.ts";

function modelById<T extends { id: string }>(models: readonly T[], id: string): T {
	const model = models.find((item) => item.id === id);
	if (!model) throw new Error(`Model not found: ${id}`);
	return model;
}

describe("native image provider capabilities", () => {
	it("matches OpenRouter's published Gemini aspect-ratio sets", () => {
		for (const id of ["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-2.5-flash-image"] as const) {
			expect(modelById(GOOGLE_IMAGE_MODELS, id).capabilities?.aspectRatios).toEqual(IMAGE_MODELS.openrouter[`google/${id}`].capabilities.aspectRatios);
		}
	});

	it("matches OpenRouter's published GPT Image aspect-ratio sets", () => {
		const nativeModels = openaiImagesProvider().getModels();
		for (const id of ["gpt-image-1", "gpt-image-1-mini", "gpt-image-2"] as const) {
			expect(modelById(nativeModels, id).capabilities?.aspectRatios).toEqual(IMAGE_MODELS.openrouter[`openai/${id}`].capabilities.aspectRatios);
		}
	});

	it("matches the documented Wan and Seedream ratios and output limits", () => {
		const wanRatios = ["1:8", "1:4", "1:2", "2:3", "3:4", "9:16", "1:1", "16:9", "4:3", "3:2", "2:1", "4:1", "8:1"];
		const seedreamRatios = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"];

		expect(modelById(BAILIAN_IMAGE_MODELS, "wan2.7-image-pro").capabilities?.aspectRatios).toEqual(wanRatios);
		expect(modelById(BAILIAN_IMAGE_MODELS, "wan2.7-image").capabilities?.aspectRatios).toEqual(wanRatios);
		expect(modelById(VOLCENGINE_IMAGE_MODELS, "doubao-seedream-5-0-pro-260628").capabilities?.aspectRatios).toEqual(seedreamRatios);
		expect(modelById(VOLCENGINE_IMAGE_MODELS, "doubao-seedream-5-0-lite-260128").capabilities).toMatchObject({
			aspectRatios: seedreamRatios,
			maxOutputImages: 15,
		});
	});
});
