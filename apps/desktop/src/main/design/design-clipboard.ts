import { clipboard, nativeImage } from "electron";

/**
 * 把一张图放进系统剪贴板。
 *
 * **与 `DesignExporter` 分开**:那个端口的契约明写着"三个方法都是往用户选的目录里写,没有读",
 * 而剪贴板既不进文件、也不属于"导出到某处"。混进去会让那句契约变成谎话。
 *
 * 本文件是这一层**唯一** import Electron 的地方 —— `handlers.ts` 只依赖接口,于是"用户按了
 * 复制之后到底发生了什么"可以在 `node --test` 里用假实现测透。
 */
export interface DesignClipboard {
  /** 剪贴板被别的程序占着的时候会失败 —— 返回 false,而不是抛。 */
  writeImage(bytes: Uint8Array): Promise<boolean>;
}

export class ElectronDesignClipboard implements DesignClipboard {
  async writeImage(bytes: Uint8Array): Promise<boolean> {
    // `createFromBuffer` 认 PNG 与 JPEG(我们的合成图就这两种)。
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (image.isEmpty()) return false;
    clipboard.writeImage(image);
    return true;
  }
}
