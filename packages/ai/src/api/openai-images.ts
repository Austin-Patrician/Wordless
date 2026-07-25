import OpenAI, { toFile } from "openai";
import type { ImageEditParamsNonStreaming, ImageGenerateParamsNonStreaming, ImagesResponse } from "openai/resources/images.js";
import type {
  AssistantImages,
  ImagesContext,
  ImagesFunction,
  ImagesModel,
  ImagesOptions,
  ProviderHeaders,
  ProviderImages,
} from "../types.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import { providerHeadersToRecord } from "../utils/headers.ts";

export const openaiImagesApi = (): ProviderImages => ({
  generateImages: (model, context, options) =>
    generateImages(model as ImagesModel<"openai-images">, context, options),
});

export const generateImages: ImagesFunction<"openai-images", ImagesOptions> = async (
  model: ImagesModel<"openai-images">,
  context: ImagesContext,
  options?: ImagesOptions,
): Promise<AssistantImages> => {
  const output: AssistantImages = {
    api: model.api,
    provider: model.provider,
    model: model.id,
    output: [],
    stopReason: "stop",
    timestamp: Date.now(),
  };

  try {
    if (!options?.apiKey) throw new Error(`No API key for provider: ${model.provider}`);
    const prompt = context.input.filter((item) => item.type === "text").map((item) => item.text).join("\n\n").trim();
    if (!prompt) throw new Error("An image prompt is required");
    const client = createClient(model, options.apiKey, options.headers);
    const references = context.input.filter((item): item is Extract<typeof item, { type: "image" }> => item.type === "image");
    let response: ImagesResponse;
    if (references.length > 0) {
      const editParams: ImageEditParamsNonStreaming = {
        model: model.id,
        prompt,
        n: context.outputCount,
        image: await Promise.all(references.map((image, index) => toFile(Buffer.from(image.data, "base64"), `wordless-reference-${index + 1}.${extensionForMimeType(image.mimeType)}`, { type: image.mimeType }))),
        ...(context.edit?.mask ? { mask: await toFile(Buffer.from(context.edit.mask.data, "base64"), "wordless-mask.png", { type: context.edit.mask.mimeType }) } : {}),
        ...(context.edit?.background ? { background: context.edit.background } : {}),
        ...(context.edit?.inputFidelity ? { input_fidelity: context.edit.inputFidelity } : {}),
      };
      response = await client.images.edit(editParams, {
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
        maxRetries: options.maxRetries ?? 0,
      });
    } else {
      response = await client.images.generate({
        model: model.id,
        n: context.outputCount,
        prompt,
        response_format: "b64_json",
      } satisfies ImageGenerateParamsNonStreaming, {
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
        maxRetries: options.maxRetries ?? 0,
      });
    }
    for (const image of response.data ?? []) {
      if (image.b64_json) output.output.push({ type: "image", mimeType: "image/png", data: image.b64_json });
    }
    if (output.output.length === 0) throw new Error("The OpenAI image API returned no image data");
    return output;
  } catch (error) {
    output.stopReason = options?.signal?.aborted ? "aborted" : "error";
    output.errorMessage = formatProviderError(normalizeProviderError(error));
    return output;
  }
};

function createClient(model: ImagesModel<"openai-images">, apiKey: string, headers?: ProviderHeaders): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    defaultHeaders: providerHeadersToRecord({ ...model.headers, ...headers }),
  });
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}
