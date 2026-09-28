/**
 * 设计能力的外部依赖,收成一个端口。
 *
 * 与仓库里其它能力一致:**能力本身不 import Electron、不读磁盘**,只依赖这个接口。
 * 于是工具的行为(输出文案、issue 判定、失败时的说法)都能用假端口测透,而真实现只有
 * 一处适配器。
 */

export interface DesignListEntry {
  path: string;
  name: string;
  frameCount: number;
}

export interface DesignFrameFactsDto {
  id: string;
  title: string;
  file: string;
  /** 帧源码里有没有 `@frame` 声明。 */
  declaredSize: boolean;
  /** 文件是否真的在磁盘上。 */
  fileExists: boolean;
}

export interface DesignFactsDto {
  path: string;
  name: string;
  mode: "static" | "built";
  style: string | null;
  /** 参考目录里有没有 `DESIGN.md`。 */
  hasDesignDoc: boolean;
  frames: DesignFrameFactsDto[];
}

export interface LayoutFinding {
  kind: string;
  selector: string;
  detail: string;
}

export interface DesignCreateInput {
  name: string;
  /** 首个帧的标题。 */
  title: string;
  /** 品类尺寸 —— 只在帧漏声明时兜底,见 `frame-size` 的优先级链。 */
  frameWidth: number;
  frameHeight: number;
}

export type DesignScreenshotResult =
  | { ok: true; frameId: string; mimeType: string; data: string }
  | { ok: false; frameId: string; reason: string };

export interface DesignPort {
  /** 当前工作区里的设计包。 */
  list(): Promise<DesignListEntry[]>;
  /** 读一份设计的事实。不是设计包时 null,而不是抛错。 */
  read(designPath: string): Promise<DesignFactsDto | null>;
  /** 建一个设计包(含一个空白帧)。 */
  create(input: DesignCreateInput): Promise<{ path: string; frameId: string } | null>;
  /** 光栅化一帧,返回 base64 编码的 JPEG。 */
  screenshot(designPath: string, frameId: string): Promise<DesignScreenshotResult>;
  /** 在离屏视图里跑布局探针。 */
  inspect(designPath: string, frameIds: readonly string[]): Promise<LayoutFinding[]>;
}
