import { openaiImagesApi } from "../api/openai-images.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createImagesProvider, type ImagesProvider } from "../images-models.ts";
import type { ImagesModel } from "../types.ts";

const OPENAI_IMAGE_MODELS: readonly ImagesModel<"openai-images">[] = [
  {
    id: "gpt-image-1.5",
    name: "GPT Image 1.5",
    api: "openai-images",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    input: ["text", "image"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    capabilities: { supportsMaskEditing: true, supportsTransparentBackground: true },
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
    capabilities: { supportsMaskEditing: true, supportsTransparentBackground: true },
  },
];

export function openaiImagesProvider(): ImagesProvider {
  return createImagesProvider({
    id: "openai",
    name: "OpenAI",
    auth: { apiKey: envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]) },
    models: OPENAI_IMAGE_MODELS,
    api: openaiImagesApi(),
  });
}
