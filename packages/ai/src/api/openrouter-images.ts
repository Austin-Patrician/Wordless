import type {
	AssistantImages,
	ImagesContext,
	ImagesFunction,
	ImagesModel,
	ImagesOptions,
} from "../types.ts";
import {
	appendEndpoint,
	applyPayloadOverride,
	createImageResult,
	downloadImage,
	finishImageError,
	generationOptions,
	imageDataUrl,
	imagePrompt,
	imageReferences,
	notifyResponse,
	outputCount,
	readJsonResponse,
	requestInit,
} from "./native-images.ts";

const OPENROUTER_IMAGES_PATH = "/images";

interface OpenRouterImagePayload {
	model: string;
	prompt: string;
	n?: number;
	resolution?: string;
	aspect_ratio?: string;
	size?: string;
	quality?: string;
	output_format?: string;
	output_compression?: number;
	background?: "transparent" | "opaque" | "auto";
	seed?: number;
	input_references?: Array<{
		type: "image_url";
		image_url: { url: string };
	}>;
}

interface OpenRouterImageResponse {
	id?: string;
	data?: Array<{
		b64_json?: string;
		url?: string;
		media_type?: string;
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
		cost?: number;
	};
}

/** OpenRouter's dedicated Images API. */
export const generateImages: ImagesFunction<"openrouter-images", ImagesOptions> = async (
	model: ImagesModel<"openrouter-images">,
	context: ImagesContext,
	options?: ImagesOptions,
): Promise<AssistantImages> => {
	const output = createImageResult(model);

	try {
		const apiKey = options?.apiKey;
		if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
		if (context.edit?.mask) throw new Error("The OpenRouter Images API does not support raster mask editing");

		const prompt = imagePrompt(context);
		if (!prompt) throw new Error("An image prompt is required");

		let payload = await applyPayloadOverride(buildPayload(model, context, prompt), model, options);
		const response = await fetch(appendEndpoint(model.baseUrl, OPENROUTER_IMAGES_PATH, "https://openrouter.ai/api/v1"), {
			...requestInit(model, apiKey, options),
			body: JSON.stringify(payload),
		});
		await notifyResponse(response, model, options);
		const parsed = await readJsonResponse<OpenRouterImageResponse>(response, "OpenRouter Images");
		output.responseId = parsed.id ?? response.headers.get("x-request-id") ?? undefined;

		for (const image of parsed.data ?? []) {
			if (image.b64_json) {
				output.output.push({
					type: "image",
					mimeType: image.media_type || mimeTypeForFormat(payload.output_format),
					data: image.b64_json,
				});
			} else if (image.url) {
				output.output.push(await downloadImage(image.url, options));
			}
		}

		if (parsed.usage) output.usage = parseUsage(parsed.usage, model);
		if (!output.output.some((item) => item.type === "image")) {
			throw new Error("The OpenRouter Images API returned no image data");
		}
		return output;
	} catch (error) {
		return finishImageError(output, error, options);
	}
};

function buildPayload(
	model: ImagesModel<"openrouter-images">,
	context: ImagesContext,
	prompt: string,
): OpenRouterImagePayload {
	const generation = generationOptions(context);
	const references = imageReferences(context);
	const payload: OpenRouterImagePayload = { model: model.id, prompt };
	const count = outputCount(context);
	if (count !== 1) payload.n = count;
	if (generation.resolution) payload.resolution = generation.resolution;
	if (generation.aspectRatio) payload.aspect_ratio = generation.aspectRatio;
	if (generation.size) payload.size = generation.size;
	if (generation.quality) payload.quality = generation.quality;
	if (generation.outputFormat) payload.output_format = generation.outputFormat;
	if (generation.outputCompression !== undefined) payload.output_compression = generation.outputCompression;
	if (generation.seed !== undefined) payload.seed = generation.seed;
	if (context.edit?.background) payload.background = context.edit.background;
	if (references.length > 0) {
		payload.input_references = references.map((image) => ({
			type: "image_url",
			image_url: { url: imageDataUrl(image) },
		}));
	}
	return payload;
}

function mimeTypeForFormat(format: string | undefined): string {
	if (format === "jpeg") return "image/jpeg";
	if (format === "webp") return "image/webp";
	return "image/png";
}

function parseUsage(
	rawUsage: NonNullable<OpenRouterImageResponse["usage"]>,
	model: ImagesModel<"openrouter-images">,
) {
	const input = Math.max(0, rawUsage.prompt_tokens ?? 0);
	const output = Math.max(0, rawUsage.completion_tokens ?? 0);
	const reportedCost = typeof rawUsage.cost === "number" ? Math.max(0, rawUsage.cost) : undefined;
	const inputCost = (model.cost.input / 1_000_000) * input;
	const outputCost = (model.cost.output / 1_000_000) * output;
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: rawUsage.total_tokens ?? input + output,
		cost: {
			input: inputCost,
			output: outputCost,
			cacheRead: 0,
			cacheWrite: 0,
			total: reportedCost ?? inputCost + outputCost,
		},
	};
}
