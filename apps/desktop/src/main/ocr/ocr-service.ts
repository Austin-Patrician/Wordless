import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OcrFailureCode, OcrGranularity, OcrProgressEvent } from "../../ocr-runner/ocr-bridge";
import type { OcrRunnerPort } from "./ocr-runner";

/**
 * OCR 服务:资产状态、文件读取、缓存、结果归一化。
 *
 * 分工是刻意的:
 * - **运行器**(`ocr-runner.ts`)只管"把字节变成文字";
 * - **服务**(这里)管"要不要真的去识别"—— 资产在不在、这份字节是不是已经识别过。
 *
 * **缓存不是优化,是必需品**:附件在**每一轮请求**都会重新水合(见
 * `agent-driver-generic` 的 `hydrateUserMessageContent`),没有缓存的话,一个五轮的对话会把
 * 同一张截图 OCR 五遍 —— 每次几百毫秒到几秒。
 */

export interface OcrAssetStatus {
  available: boolean;
  /** 形如 `ppocrv5`;资产缺失时为 `null`。 */
  modelSet: string | null;
  /** 一句话说明,直接给界面用。 */
  detail: string;
}

export interface OcrImageInput {
  /** 绝对路径;读取由服务负责,调用方不必先读进内存。 */
  path: string;
  /** 给模型看的名字(通常是文件名)。 */
  name: string;
  mimeType: string;
}

export interface OcrRecognitionPage {
  name: string;
  path: string;
  text: string;
  /** 只有粒度是 `line` 时非空。 */
  lines?: Array<{ text: string; confidence: number }>;
  lineCount: number;
  width: number;
  height: number;
  confidence: number;
  durationMs: number;
}

export interface OcrRecognition {
  engine: string;
  pages: OcrRecognitionPage[];
  totalDurationMs: number;
  /** 首次加载引擎的耗时(冷启动);热态为 0。 */
  loadMs: number;
  /** 是否全部命中缓存。 */
  cached: boolean;
}

export type OcrRecognitionOutcome =
  | { ok: true; recognition: OcrRecognition }
  | { ok: false; code: OcrFailureCode; message: string };

/**
 * 服务在每次识别时现读的选项。
 *
 * **现读而不是构造时快照**:用户在设置里关掉缓存或改粒度之后,下一次识别就该按新的来 ——
 * 服务是长生命周期对象,快照会让设置看起来"要点重启才生效"。
 */
export interface OcrRuntimeOptions {
  cache: boolean;
  granularity: OcrGranularity;
}

export interface OcrServiceOptions {
  /** `resources/ocr`(打包后在 `resources/ocr`)。 */
  assetsRoot: string;
  /** 缓存目录(用户目录下的 `ocr-cache`)。 */
  cacheRoot: string;
  runner: OcrRunnerPort;
  /** 单张图的上限。默认 25MB:再大就不是"贴一张截图"了。 */
  maxBytesPerImage?: number;
  /** 读当前选项(缓存开关、粒度)。省略 = 缓存开、粒度 text。 */
  readOptions?: () => OcrRuntimeOptions;
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

interface CachedPage {
  name: string;
  text: string;
  lines?: Array<{ text: string; confidence: number }>;
  lineCount: number;
  width: number;
  height: number;
  confidence: number;
  durationMs: number;
}

interface CachedRecognition {
  engine: string;
  pages: CachedPage[];
  totalDurationMs: number;
}

export class OcrService {
  private readonly options: OcrServiceOptions;
  private cachedStatus: OcrAssetStatus | null = null;

  constructor(options: OcrServiceOptions) {
    this.options = options;
  }

  /**
   * 资产是否就绪。
   *
   * 判定依据是**构建期写下的标记 + 文件在不在**(标记只在全部校验通过之后才写,见
   * `prepare-ocr-assets.mjs`)。不用"跑一次试试"来判定:那要加载 21MB 模型,而界面只是想知道
   * "这一栏要不要显示未就绪"。
   */
  async status(): Promise<OcrAssetStatus> {
    // **只缓存"就绪"**,不缓存"未就绪"。
    //
    // 资产缺失在正式包里是稳定的(它们随包发布),但在**开发期不稳定**:应用可能先起来、资产
    // 后到位。缓存一次否,整个进程生命周期都会说"没有文字识别" —— 而用户手上明明有资产。
    // 否定的判定只是几次 stat,不值得缓存。
    if (this.cachedStatus !== null) return this.cachedStatus;
    const marker = await readFile(join(this.options.assetsRoot, ".wordless-ocr-version"), "utf8").catch(() => "");
    const trimmed = marker.trim();
    if (trimmed === "" || trimmed === "skipped") {
      // 把**看的是哪个目录**写进说明:开发包与正式包的根不一样,这一句能直接分辨。
      return {
        available: false,
        modelSet: null,
        detail: `Text recognition assets are not bundled in this build (looked in ${this.options.assetsRoot}).`,
      };
    }
    const modelSet = trimmed.split(":")[0] ?? null;
    for (const relative of ["models/ppocrv5_det.onnx", "models/ppocrv5_rec.onnx", "models/ppocrv5_dict.txt", "ort/ort-wasm-simd-threaded.jsep.wasm"]) {
      const present = await stat(join(this.options.assetsRoot, relative)).then(
        (info) => info.isFile() && info.size > 0,
        () => false,
      );
      if (!present) {
        return {
          available: false,
          modelSet,
          detail: `Text recognition assets are incomplete (${relative} is missing under ${this.options.assetsRoot}).`,
        };
      }
    }
    this.cachedStatus = { available: true, modelSet, detail: `Ready (${modelSet}).` };
    return this.cachedStatus;
  }

  /** 资产变化后重新探测(例如用户重装应用之后)。 */
  invalidateStatus(): void {
    this.cachedStatus = null;
  }

  /** 从磁盘上的文件识别(工具与附件走这条)。 */
  async recognize(
    images: OcrImageInput[],
    options: { signal: AbortSignal; onProgress?: (event: OcrProgressEvent) => void; granularity?: OcrGranularity },
  ): Promise<OcrRecognitionOutcome> {
    if (images.length === 0) return { ok: false, code: "pipeline-error", message: "No images to recognize" };
    const loaded: Array<{ image: OcrImageInput; bytes: Buffer }> = [];
    for (const image of images) {
      const bytes = await readFile(image.path).catch(() => null);
      if (bytes === null) return { ok: false, code: "pipeline-error", message: `Cannot read ${image.path}` };
      loaded.push({ image, bytes });
    }
    return await this.recognizeBuffers(loaded, options);
  }

  /**
   * 直接识别内存里的字节(浏览器截图走这条)。
   *
   * 与文件那条**共用缓存**:缓存键是内容哈希,所以同一张截图无论来自路径还是字节,都只识别一次。
   * 截图不落盘 —— 为了 OCR 往用户工作区写文件是没必要的副作用。
   */
  async recognizeBuffers(
    images: Array<{ image: OcrImageInput; bytes: Buffer }>,
    options: { signal: AbortSignal; onProgress?: (event: OcrProgressEvent) => void; granularity?: OcrGranularity },
  ): Promise<OcrRecognitionOutcome> {
    if (images.length === 0) return { ok: false, code: "pipeline-error", message: "No images to recognize" };
    const status = await this.status();
    if (!status.available) return { ok: false, code: "assets-missing", message: status.detail };

    const maxBytes = this.options.maxBytesPerImage ?? DEFAULT_MAX_BYTES;
    const prepared: Array<{ image: OcrImageInput; bytes: ArrayBuffer; key: string }> = [];
    for (const item of images) {
      if (item.bytes.byteLength > maxBytes) {
        return { ok: false, code: "pipeline-error", message: `${item.image.name} is larger than ${Math.round(maxBytes / 1024 / 1024)}MB` };
      }
      prepared.push({ image: item.image, bytes: toArrayBuffer(item.bytes), key: this.cacheKey(item.bytes, status.modelSet ?? "unknown") });
    }

    const settings = this.options_();
    // 全部命中缓存就不再起窗口:一个五轮对话里,第二到第五轮在这里就返回了。
    // 用户关掉缓存时不读也不写 —— 那正是"关掉"的意思(排查旧结果、或不想让结果落盘)。
    if (settings.cache) {
      const cached = await Promise.all(prepared.map((item) => this.readCache(item.key)));
      if (cached.every((entry) => entry !== null)) {
        return { ok: true, recognition: mergeCached(prepared, cached as CachedRecognition[]) };
      }
    }

    const outcome = await this.options.runner.recognize(
      prepared.map((item) => ({ name: item.image.name, mimeType: item.image.mimeType, bytes: item.bytes })),
      // 调用方显式给了粒度就用它的(工具参数),否则用设置里的默认值。
      { ...options, granularity: options.granularity ?? settings.granularity },
    );
    if (!outcome.ok) return outcome;

    const recognition: OcrRecognition = {
      engine: outcome.result.engine,
      pages: outcome.result.pages.map((page, index) => ({
        name: page.name,
        path: prepared[index]?.image.path ?? page.name,
        text: page.text,
        lines: page.lines,
        lineCount: page.lineCount,
        width: page.width,
        height: page.height,
        confidence: page.confidence,
        durationMs: page.durationMs,
      })),
      totalDurationMs: outcome.result.totalDurationMs,
      loadMs: outcome.result.loadMs,
      cached: false,
    };
    if (!settings.cache) return { ok: true, recognition };
    await Promise.all(recognition.pages.map((page, index) => this.writeCache(prepared[index]?.key ?? "", {
      engine: recognition.engine,
      pages: [page],
      totalDurationMs: recognition.totalDurationMs,
    })));
    return { ok: true, recognition };
  }

  /** 缓存键:内容哈希 + 模型集。**不含路径**:同一个文件换位置不该重新识别。 */
  private cacheKey(bytes: Buffer, modelSet: string): string {
    return createHash("sha256").update(bytes).update(`|${modelSet}`).digest("hex");
  }

  /** 当前选项。省略 `readOptions` 时是"缓存开、粒度 text"。 */
  private options_(): OcrRuntimeOptions {
    return this.options.readOptions?.() ?? { cache: true, granularity: "text" };
  }

  private async readCache(key: string): Promise<CachedRecognition | null> {
    const raw = await readFile(join(this.options.cacheRoot, `${key}.json`), "utf8").catch(() => null);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as CachedRecognition;
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, value: CachedRecognition): Promise<void> {
    if (key === "") return;
    await mkdir(this.options.cacheRoot, { recursive: true });
    await writeFile(join(this.options.cacheRoot, `${key}.json`), JSON.stringify(value), "utf8").catch(() => undefined);
  }
}

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** 全部命中缓存时的合并结果:顺序跟调用方给的一致。 */
function mergeCached(
  prepared: Array<{ image: OcrImageInput; bytes: ArrayBuffer; key: string }>,
  cached: CachedRecognition[],
): OcrRecognition {
  const pages = cached.flatMap((entry, index) =>
    entry.pages.map((page) => ({
      name: prepared[index]?.image.name ?? page.name,
      path: prepared[index]?.image.path ?? page.name,
      text: page.text,
      lines: page.lines,
      lineCount: page.lineCount,
      width: page.width,
      height: page.height,
      confidence: page.confidence,
      durationMs: page.durationMs,
    })),
  );
  return {
    engine: cached[0]?.engine ?? "cached",
    pages,
    totalDurationMs: 0,
    loadMs: 0,
    cached: true,
  };
}
