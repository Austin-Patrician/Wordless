import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { nativeImage } from "electron";
import type { AppearanceBackgroundAsset } from "@wordless/domain";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 4_096;
const assetIdPattern = /^[a-f0-9]{64}\.(?:jpg|png|webp)$/;

type AppearanceImageMimeType = AppearanceBackgroundAsset["mimeType"];

function imageFormat(filePath: string): { extension: "jpg" | "png" | "webp"; mimeType: AppearanceImageMimeType } | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return { extension: "jpg", mimeType: "image/jpeg" };
  if (extension === ".png") return { extension: "png", mimeType: "image/png" };
  if (extension === ".webp") return { extension: "webp", mimeType: "image/webp" };
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
    if (!format) throw new Error("Choose a PNG, JPEG, or WebP image");

    const metadata = await stat(sourcePath);
    if (!metadata.isFile()) throw new Error("The selected background is not a file");
    if (metadata.size > MAX_FILE_BYTES) throw new Error("The selected image must be 20 MB or smaller");

    const normalized = normalizedImageData(await readFile(sourcePath), format);
    if (normalized.data.byteLength > MAX_FILE_BYTES) throw new Error("The selected image remains larger than 20 MB after optimization");
    const assetId = `${createHash("sha256").update(normalized.data).digest("hex")}.${normalized.extension}`;
    const destination = path.join(this.root, assetId);
    await mkdir(this.root, { recursive: true });
    try {
      await writeFile(destination, normalized.data, { flag: "wx" });
    } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EEXIST") throw cause;
    }
    return { assetId, mimeType: normalized.mimeType, width: normalized.width, height: normalized.height };
  }

  async remove(assetId: string): Promise<void> {
    if (!assetIdPattern.test(assetId)) throw new Error("Invalid background asset");
    await rm(path.join(this.root, assetId), { force: true });
  }
}
