import type {
	AssistantImages,
	ImageContent,
	ImagesContext,
	ImagesFunction,
	ImagesModel,
	ImagesOptions,
	ProviderImages,
} from "../types.ts";
import {
	asString,
	applyPayloadOverride,
	appendEndpoint,
	createImageResult,
	downloadImage,
	finishImageError,
	generationOptions,
	imageDataUrl,
	imagePrompt,
	imageReferences,
	isRecord,
	modelConnection,
	notifyResponse,
	outputCount,
	readJsonResponse,
	requestInit,
} from "./native-images.ts";

export const VOLCENGINE_IMAGE_BASE_URL = "https://ark.cn-beijing.volces.com";
export const VOLCENGINE_IMAGE_INTL_BASE_URL = "https://ark.ap-southeast.bytepluses.com";
export const VOLCENGINE_IMAGE_PATH = "/api/v3/images/generations";

type VolcengineImagesModel = ImagesModel<"volcengine-images">;

interface VolcengineImagePayload {
	model: string;
	prompt: string;
	response_format: "b64_json";
	sequential_image_generation: "disabled" | "auto";
	sequential_image_generation_options?: { max_images: number };
	image?: string | string[];
	[key: string]: unknown;
}

interface VolcengineImageItem {
	b64_json?: unknown;
	url?: unknown;
	image_url?: unknown;
	mime_type?: unknown;
	mimeType?: unknown;
	output_format?: unknown;
}

/** Native Volcengine Ark / Doubao Seedream image protocol. */
export const volcengineImagesApi = (): ProviderImages => ({
	generateImages: (model, context, options) =>
		generateImages(model as VolcengineImagesModel, context, options),
});

/** Alias for callers that use the model-family name. */
export const seedreamImagesApi = volcengineImagesApi;

export const generateImages: ImagesFunction<"volcengine-images", ImagesOptions> = async (
	model: VolcengineImagesModel,
	context: ImagesContext,
	options?: ImagesOptions,
): Promise<AssistantImages> => {
	const result = createImageResult(model);

	try {
		if (!options?.apiKey) throw new Error(`No API key for provider: ${model.provider}`);
		const prompt = imagePrompt(context);
		if (!prompt) throw new Error("An image prompt is required");
		if (context.edit?.mask) {
			throw new Error("The Seedream image adapter does not support raster mask editing");
		}
		if (context.edit?.background) {
			throw new Error("The Seedream image adapter does not support transparent background output");
		}
		if (context.edit?.inputFidelity) {
			throw new Error("The Seedream image adapter does not support input fidelity controls");
		}

		const payload = await applyPayloadOverride(buildPayload(model, context), model, options);
		const endpoint = resolveVolcengineEndpoint(model);
		const init = requestInit(model, options.apiKey, options);
		init.body = JSON.stringify(payload);
		const response = await fetch(endpoint, init);
		await notifyResponse(response, model, options);
		const body = await readJsonResponse<unknown>(response, "Volcengine");
		result.responseId = findResponseId(body);

		const images = extractImages(body, generationOptions(context));
		for (const image of images) {
			if (image.kind === "base64") {
				result.output.push({ type: "image", mimeType: image.mimeType, data: image.value });
			} else {
				result.output.push(await downloadImage(image.value, options));
			}
		}
		if (result.output.filter((item) => item.type === "image").length === 0) {
			throw new Error("The Seedream image API returned no image data");
		}
		return result;
	} catch (error) {
		return finishImageError(result, error, options);
	}
};

function buildPayload(model: VolcengineImagesModel, context: ImagesContext): VolcengineImagePayload {
	const generation = generationOptions(context);
	const count = outputCount(context);
	const payload: VolcengineImagePayload = {
		model: model.id,
		prompt: imagePrompt(context),
		response_format: "b64_json",
		sequential_image_generation: count === 1 ? "disabled" : "auto",
		...(count > 1 ? { sequential_image_generation_options: { max_images: count } } : {}),
	};
	const references = imageReferences(context).map(imageDataUrl);
	if (references.length > 0) payload.image = references.length === 1 ? references[0] : references;

	const size = resolveVolcengineSize(generation);
	if (size) payload.size = size;
	if (typeof generation.quality === "string" && generation.quality.length > 0) payload.quality = generation.quality;
	if (typeof generation.seed === "number" && Number.isFinite(generation.seed)) payload.seed = generation.seed;
	payload.watermark = typeof generation.watermark === "boolean" ? generation.watermark : false;
	if (typeof generation.outputFormat === "string" && generation.outputFormat.length > 0) {
		payload.output_format = generation.outputFormat;
	}
	if (typeof generation.outputCompression === "number" && Number.isFinite(generation.outputCompression)) {
		payload.output_compression = generation.outputCompression;
	}
	if (generation.promptEnhancement !== undefined && generation.promptEnhancement !== false) {
		const mode = typeof generation.promptEnhancement === "string" ? generation.promptEnhancement : "standard";
		if (mode !== "off") payload.optimize_prompt_options = { mode };
	}
	return payload;
}

function resolveVolcengineSize(generation: ReturnType<typeof generationOptions>): string | undefined {
	const candidate = asString(generation.resolution) ?? asString(generation.size);
	const aspectRatio = asString(generation.aspectRatio);
	if (candidate && candidate !== "auto") {
		if (/^\d+x\d+$/i.test(candidate)) return candidate;
		if (/^\d+\*\d+$/.test(candidate)) return candidate.replace("*", "x");
		if (/^(?:1K|2K|3K|4K)$/i.test(candidate)) {
			return aspectRatio ? sizeForAspectRatio(aspectRatio, candidate) : candidate.toUpperCase();
		}
	}
	return sizeForAspectRatio(aspectRatio);
}

function sizeForAspectRatio(aspectRatio: string | undefined, resolution?: string): string | undefined {
	if (!aspectRatio) return undefined;
	const [width, height] = aspectRatio.split(":").map(Number);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
	const tier = resolution?.toUpperCase();
	const longestSide = tier === "4K" ? 4096 : tier === "3K" ? 3072 : tier === "2K" ? 2048 : 1536;
	const scale = longestSide / Math.max(width, height);
	const scaledWidth = Math.max(512, Math.round((width * scale) / 16) * 16);
	const scaledHeight = Math.max(512, Math.round((height * scale) / 16) * 16);
	return `${scaledWidth}x${scaledHeight}`;
}

function resolveVolcengineEndpoint(model: VolcengineImagesModel): string {
	const connection = modelConnection(model);
	const region = String(connection.region ?? "").toLowerCase();
	const isInternational = ["intl", "international", "singapore", "sg", "ap-southeast-1", "byteplus"].includes(region);
	const fallback = isInternational ? VOLCENGINE_IMAGE_INTL_BASE_URL : VOLCENGINE_IMAGE_BASE_URL;
	let configured = (asString(connection.endpoint) ?? asString(model.baseUrl))?.replace(/\/+$/, "");
	if (configured && isVolcengineDefaultHost(configured)) {
		configured = configured.replace(/^https:\/\/ark\.(?:cn-beijing\.volces\.com|ap-southeast\.bytepluses\.com)/, fallback);
	}
	if (configured?.endsWith(VOLCENGINE_IMAGE_PATH)) return configured;
	if (configured?.endsWith("/api/v3")) return `${configured}${VOLCENGINE_IMAGE_PATH.slice("/api/v3".length)}`;
	return appendEndpoint(configured, VOLCENGINE_IMAGE_PATH, fallback);
}

function isVolcengineDefaultHost(value: string): boolean {
	return /^https:\/\/ark\.(?:cn-beijing\.volces\.com|ap-southeast\.bytepluses\.com)(?:\/|$)/.test(value);
}

interface ExtractedImage {
	kind: "base64" | "url";
	data?: string;
	value: string;
	mimeType: string;
}

function extractImages(body: unknown, generation: ReturnType<typeof generationOptions>): ExtractedImage[] {
	if (!isRecord(body)) return [];
	const candidates = Array.isArray(body.data) ? body.data : [];
	const fallbackMime = mimeTypeForFormat(asString(generation.outputFormat));
	const result: ExtractedImage[] = [];
	for (const candidate of candidates) {
		if (!isRecord(candidate)) continue;
		const item = candidate as VolcengineImageItem;
		const itemFormat = asString(item.mime_type) ?? asString(item.mimeType) ?? asString(item.output_format);
		const mimeType = itemFormat ? mimeTypeForFormat(itemFormat) : fallbackMime;
		const base64 = asString(item.b64_json);
		if (base64) {
			const inline = parseDataUrl(base64);
			result.push(inline ? { ...inline, kind: "base64", value: inline.data } : { kind: "base64", value: base64, data: base64, mimeType });
			continue;
		}
		const url = asString(item.url) ?? asString(item.image_url);
		if (url) {
			const inline = parseDataUrl(url);
			result.push(inline ? { ...inline, kind: "base64", value: inline.data } : { kind: "url", value: url, mimeType });
		}
	}
	return result;
}

function parseDataUrl(value: string): { data: string; mimeType: string } | undefined {
	const match = value.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s);
	return match ? { mimeType: match[1] || "image/png", data: match[2] } : undefined;
}

function mimeTypeForFormat(format: string | undefined): string {
	if (!format) return "image/png";
	if (format.includes("/")) return format;
	if (format.toLowerCase() === "jpg") return "image/jpeg";
	return `image/${format.toLowerCase()}`;
}

function findResponseId(body: unknown): string | undefined {
	if (!isRecord(body)) return undefined;
	return asString(body.id) ?? asString(body.request_id);
}
