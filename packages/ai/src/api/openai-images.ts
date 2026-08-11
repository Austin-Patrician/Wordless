import OpenAI, { toFile } from "openai";
import type {
	ImageEditParamsNonStreaming,
	ImageGenerateParamsNonStreaming,
	ImagesResponse,
} from "openai/resources/images.js";
import type {
	AssistantImages,
	ImageOutputFormat,
	ImagesContext,
	ImagesFunction,
	ImagesModel,
  ImagesOptions,
  ProviderHeaders,
  ProviderImages,
} from "../types.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import { headersToRecord, providerHeadersToRecord } from "../utils/headers.ts";

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
		if (context.edit?.mask && model.capabilities?.supportsMaskEditing === false) {
			throw new Error("The selected OpenAI image model does not support mask editing");
		}
		if (context.edit?.background === "transparent" && model.capabilities?.supportsTransparentBackground === false) {
			throw new Error("The selected OpenAI image model does not support transparent background output");
		}
		if (context.edit?.mask && context.input.every((item) => item.type !== "image")) {
			throw new Error("A reference image is required when using a mask");
		}
		const client = createClient(model, options.apiKey, options.headers);
		const references = context.input.filter((item): item is Extract<typeof item, { type: "image" }> => item.type === "image");
		let response: ImagesResponse;
		if (references.length > 0) {
			let editParams: ImageEditParamsNonStreaming = {
				model: model.id,
				prompt,
				...buildCommonParams(model, context, true),
				image: await Promise.all(
					references.map((image, index) =>
						toFile(
							Buffer.from(image.data, "base64"),
							`wordless-reference-${index + 1}.${extensionForMimeType(image.mimeType)}`,
							{ type: image.mimeType },
						),
					),
				),
				...(context.edit?.mask
					? {
							mask: await toFile(
								Buffer.from(context.edit.mask.data, "base64"),
								"wordless-mask.png",
								{ type: context.edit.mask.mimeType },
							),
						}
					: {}),
				...(context.edit?.background ? { background: context.edit.background } : {}),
				...(context.edit?.inputFidelity && supportsInputFidelity(model.id)
					? { input_fidelity: context.edit.inputFidelity }
					: {}),
			};
			const nextParams = await options.onPayload?.(editParams, model);
			if (nextParams !== undefined) editParams = nextParams as ImageEditParamsNonStreaming;
			const request = client.images.edit(editParams, {
				...(options.signal ? { signal: options.signal } : {}),
				...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
				maxRetries: options.maxRetries ?? 0,
			});
			response = await resolveImagesResponse(request, options, model);
		} else {
			let generateParams: ImageGenerateParamsNonStreaming = {
				model: model.id,
				prompt,
				...buildCommonParams(model, context, false),
				...(context.edit?.background ? { background: context.edit.background } : {}),
			};
			const nextParams = await options.onPayload?.(generateParams, model);
			if (nextParams !== undefined) generateParams = nextParams as ImageGenerateParamsNonStreaming;
			const request = client.images.generate(generateParams, {
				...(options.signal ? { signal: options.signal } : {}),
				...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
				maxRetries: options.maxRetries ?? 0,
			});
			response = await resolveImagesResponse(request, options, model);
		}
		for (const image of response.data ?? []) {
			if (image.b64_json) {
				output.output.push({
					type: "image",
					mimeType: mimeTypeForFormat(response.output_format ?? generationOutputFormat(context)),
					data: image.b64_json,
				});
			} else if (image.url) {
				const resolved = await downloadImage(image.url, options.signal);
				if (resolved) output.output.push({ type: "image", ...resolved });
			}
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

type ImageGenerationOptions = NonNullable<ImagesContext["generation"]>;
type OpenAIImageParams = Record<string, unknown>;

/**
 * Translate Wordless's provider-neutral image controls to the OpenAI image
 * request fields. GPT Image 2 accepts flexible dimensions, while earlier
 * GPT Image models accept the three documented fixed dimensions or `auto`.
 */
function buildCommonParams(
	model: ImagesModel<"openai-images">,
	context: ImagesContext,
	isEdit: boolean,
): OpenAIImageParams {
	const generation = context.generation;
	const params: OpenAIImageParams = {};
	if (context.outputCount !== undefined) params.n = context.outputCount;

	const size = resolveOpenAISize(model.id, generation);
	if (size) params.size = size;
	if (generation?.quality) params.quality = normalizeOpenAIQuality(generation.quality);
	if (generation?.outputFormat) params.output_format = normalizeOutputFormat(generation.outputFormat);
	if (
		generation?.outputCompression !== undefined &&
		(generation.outputFormat === "jpeg" || generation.outputFormat === "webp")
	) params.output_compression = generation.outputCompression;
	void isEdit;
	return params;
}

function resolveOpenAISize(modelId: string, generation: ImageGenerationOptions | undefined): string | undefined {
	const explicit = generation?.size?.trim() || generation?.resolution?.trim();
	const ratio = generation?.aspectRatio?.trim();
	if (isGptImage2(modelId)) {
		if (explicit === "auto") return "auto";
		if (ratio === "auto") return "auto";
		if (explicit && isValidGptImage2Size(explicit)) return explicit;
		if (explicit && /^(?:1K|2K|4K)$/i.test(explicit)) return sizeForResolutionTier(explicit, ratio);
		if (ratio) return sizeForResolutionTier("1K", ratio);
		return undefined;
	}
	if (explicit && isOpenAILegacySize(explicit)) return explicit;
	if (ratio === "auto") return "auto";
	if (!ratio) return undefined;
	if (ratio === "1:1") return "1024x1024";
	const [width, height] = ratio.split(":").map(Number);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
	return width >= height ? "1536x1024" : "1024x1536";
}

function isOpenAILegacySize(value: string): value is "auto" | "1024x1024" | "1536x1024" | "1024x1536" {
	return value === "auto" || value === "1024x1024" || value === "1536x1024" || value === "1024x1536";
}

function isGptImage2(modelId: string): boolean {
	return /(?:^|\/)gpt-image-2(?:-|$)/.test(modelId);
}

function isValidGptImage2Size(value: string): boolean {
	const match = value.match(/^(\d+)x(\d+)$/i);
	if (!match) return false;
	const width = Number(match[1]);
	const height = Number(match[2]);
	const pixels = width * height;
	return width <= 3840 && height <= 3840 && width % 16 === 0 && height % 16 === 0 &&
		Math.max(width, height) / Math.min(width, height) <= 3 && pixels >= 655_360 && pixels <= 8_294_400;
}

function sizeForResolutionTier(tier: string, ratio: string | undefined): string {
	const parsed = parseAspectRatio(ratio) ?? { width: 1, height: 1 };
	const aspect = parsed.width / parsed.height;
	const targetPixels = tier.toUpperCase() === "4K" ? 8_000_000 : tier.toUpperCase() === "2K" ? 4_000_000 : 1_050_000;
	let width = Math.sqrt(targetPixels * aspect);
	let height = width / aspect;
	const scale = Math.min(1, 3840 / Math.max(width, height));
	width = Math.max(16, Math.round((width * scale) / 16) * 16);
	height = Math.max(16, Math.round((height * scale) / 16) * 16);
	return `${width}x${height}`;
}

function parseAspectRatio(value: string | undefined): { width: number; height: number } | undefined {
	if (!value) return undefined;
	const [width, height] = value.split(":").map(Number);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
	if (Math.max(width, height) / Math.min(width, height) > 3) return undefined;
	return { width, height };
}

function normalizeOpenAIQuality(value: string): string {
	return value === "standard" || value === "hd" ? value : value;
}

function normalizeOutputFormat(value: string): ImageOutputFormat {
	if (value === "jpeg" || value === "webp") return value;
	return "png";
}

function generationOutputFormat(context: ImagesContext): ImageOutputFormat {
	const value = context.generation?.outputFormat;
	return value === "jpeg" || value === "webp" ? value : "png";
}

function mimeTypeForFormat(format: string): string {
	if (format === "jpeg" || format === "jpg") return "image/jpeg";
	if (format === "webp") return "image/webp";
	return "image/png";
}

function supportsInputFidelity(modelId: string): boolean {
	return isGptImage2(modelId) || /gpt-image-1(?:\.5)?$/.test(modelId);
}

async function resolveImagesResponse(
	request: Promise<ImagesResponse> & { withResponse?: () => Promise<{ data: ImagesResponse; response: Response }> },
	options: ImagesOptions,
	model: ImagesModel<"openai-images">,
): Promise<ImagesResponse> {
	if (typeof request.withResponse === "function") {
		const result = await request.withResponse();
		await options.onResponse?.({ status: result.response.status, headers: headersToRecord(result.response.headers) }, model);
		return result.data;
	}
	return await request;
}

async function downloadImage(url: string, signal?: AbortSignal): Promise<{ mimeType: string; data: string } | undefined> {
	if (url.startsWith("data:")) {
		const match = url.match(/^data:([^;]+);base64,(.+)$/);
		return match ? { mimeType: match[1]!, data: match[2]! } : undefined;
	}
	const response = await fetch(url, signal ? { signal } : undefined);
	if (!response.ok) return undefined;
	const bytes = Buffer.from(await response.arrayBuffer());
	return { mimeType: response.headers.get("content-type")?.split(";", 1)[0] || "image/png", data: bytes.toString("base64") };
}
