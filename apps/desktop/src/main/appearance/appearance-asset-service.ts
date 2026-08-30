import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { nativeImage } from "electron";
import type { AppearanceBackgroundAsset } from "@wordless/domain";

type SharpFactory = typeof import("sharp").default;
let sharpFactoryPromise: Promise<SharpFactory> | undefined;

async function getSharp(): Promise<SharpFactory> {
  sharpFactoryPromise ??= import("sharp").then((module) => module.default);
  try {
    return await sharpFactoryPromise;
  } catch (error) {
    sharpFactoryPromise = undefined;
    throw error;
  }
}

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 4_096;
const MAX_ANIMATED_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ANIMATED_DIMENSION = 2_048;
const MAX_ANIMATED_FRAMES = 600;
// sharp applies limitInputPixels to the complete animated image, not one frame.
const MAX_ANIMATED_TOTAL_PIXELS = MAX_ANIMATED_DIMENSION * MAX_ANIMATED_DIMENSION * 120;
const MAX_ANIMATED_DURATION_MS = 30_000;
const assetIdPattern = /^[a-f0-9]{64}(?:-poster)?\.(?:jpg|png|webp|gif)$/;

type AppearanceImageMimeType = AppearanceBackgroundAsset["mimeType"];

function imageFormat(filePath: string): { extension: "jpg" | "png" | "webp" | "gif"; mimeType: AppearanceImageMimeType; animated: boolean } | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return { extension: "jpg", mimeType: "image/jpeg", animated: false };
  if (extension === ".png") return { extension: "png", mimeType: "image/png", animated: false };
  if (extension === ".webp") return { extension: "webp", mimeType: "image/webp", animated: false };
  if (extension === ".gif") return { extension: "gif", mimeType: "image/gif", animated: true };
  return null;
}

function normalizedImageData(data: Buffer, format: { extension: "jpg" | "png" | "webp"; mimeType: AppearanceImageMimeType }): { data: Buffer; extension: "jpg" | "png" | "webp"; mimeType: AppearanceImageMimeType; width: number; height: number } {
  const image = nativeImage.createFromBuffer(data);
  if (image.isEmpty()) throw new Error("The selected file is not a valid image");

  const size = image.getSize();
  if (size.width <= 0 || size.height <= 0) throw new Error("The selected image has invalid dimensions");
  if (Math.max(size.width, size.height) <= MAX_DIMENSION) return { data, ...format, width: size.width, height: size.height };

  const ratio = MAX_DIMENSION / Math.max(size.width, size.height);
  const width = Math.max(1, Math.round(size.width * ratio));
  const height = Math.max(1, Math.round(size.height * ratio));
  const resized = image.resize({ width, height, quality: "best" });
  if (format.mimeType === "image/jpeg") return { data: resized.toJPEG(90), extension: "jpg", mimeType: "image/jpeg", width, height };
  return { data: resized.toPNG(), extension: "png", mimeType: "image/png", width, height };
}

async function importAnimatedGif(data: Buffer): Promise<{ width: number; height: number; poster: Buffer; frames: number; durationMs: number }> {
  const sharp = await getSharp();
  const image = sharp(data, { animated: true, limitInputPixels: MAX_ANIMATED_TOTAL_PIXELS });
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.pageHeight ?? metadata.height ?? 0;
  const frames = metadata.pages ?? 1;
  const delays = metadata.delay ?? [];
  const durationMs = delays.length > 0 ? delays.reduce((sum, delay) => sum + delay, 0) : 0;
  if (width <= 0 || height <= 0) throw new Error("The selected GIF has invalid dimensions");
  if (Math.max(width, height) > MAX_ANIMATED_DIMENSION) throw new Error("GIF backgrounds must be 2048 px or smaller");
  if (frames > MAX_ANIMATED_FRAMES) throw new Error("GIF backgrounds must contain 120 frames or fewer");
  if (durationMs > MAX_ANIMATED_DURATION_MS) throw new Error("GIF backgrounds must be 30 seconds or shorter");
  const poster = await sharp(data, { page: 0 }).png().toBuffer();
  return { width, height, poster, frames, durationMs };
}

export function appearanceAssetUrl(assetId: string): string {
  return `wordless-appearance://background/${encodeURIComponent(assetId)}`;
}

export class AppearanceAssetService {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async import(sourcePath: string): Promise<AppearanceBackgroundAsset> {
    const format = imageFormat(sourcePath);
    if (!format) throw new Error("Choose a PNG, JPEG, WebP, or GIF image");

    const metadata = await stat(sourcePath);
    if (!metadata.isFile()) throw new Error("The selected background is not a file");
    if (metadata.size > (format.animated ? MAX_ANIMATED_FILE_BYTES : MAX_FILE_BYTES))
      throw new Error(format.animated ? "GIF backgrounds must be 8 MB or smaller" : "The selected image must be 20 MB or smaller");

    const sourceData = await readFile(sourcePath);
    if (format.animated) {
      const animated = await importAnimatedGif(sourceData);
      const digest = createHash("sha256").update(sourceData).digest("hex");
      const assetId = `${digest}.gif`;
      const posterAssetId = `${digest}-poster.png`;
      await mkdir(this.root, { recursive: true });
      await this.writeIfMissing(assetId, sourceData);
      await this.writeIfMissing(posterAssetId, animated.poster);
      return { assetId, posterAssetId, animated: true, mimeType: "image/gif", width: animated.width, height: animated.height };
    }

    const normalized = normalizedImageData(sourceData, { extension: format.extension as "jpg" | "png" | "webp", mimeType: format.mimeType });
    if (normalized.data.byteLength > MAX_FILE_BYTES) throw new Error("The selected image remains larger than 20 MB after optimization");
    const assetId = `${createHash("sha256").update(normalized.data).digest("hex")}.${normalized.extension}`;
    await mkdir(this.root, { recursive: true });
    await this.writeIfMissing(assetId, normalized.data);
    return { assetId, mimeType: normalized.mimeType, width: normalized.width, height: normalized.height };
  }

  private async writeIfMissing(assetId: string, data: Buffer): Promise<void> {
    try {
      await writeFile(path.join(this.root, assetId), data, { flag: "wx" });
    } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EEXIST") throw cause;
    }
  }

  async remove(assetId: string): Promise<void> {
    if (!assetIdPattern.test(assetId)) throw new Error("Invalid background asset");
    await rm(path.join(this.root, assetId), { force: true });
    if (assetId.endsWith(".gif")) {
      const digest = assetId.slice(0, -4);
      await rm(path.join(this.root, `${digest}-poster.png`), { force: true });
    }
  }
}
