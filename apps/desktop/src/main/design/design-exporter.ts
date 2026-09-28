import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 导出渲染图与资源时用到的那点宿主能力,收成一个端口。
 *
 * 与仓库里其它能力一致:**`handlers.ts` 不 import Electron**,于是"用户选了哪个目录"
 * (对话框)与"文件写到哪"这两件事都以端口的形式注入 —— 边界本身能在 `node --test` 里测透。
 *
 * 三个方法都是"往用户选的目录里写",没有读:导出是单向的,不该有机会碰到设计包。
 */
export interface DesignExporter {
  /** 让用户挑一个目标目录。取消返回 null。 */
  chooseDirectory(): Promise<string | null>;
  /**
   * 让用户挑一个**具体文件**的落点(合成图是单文件,不是一批)。
   *
   * 与 `chooseDirectory` 分成两个方法而不是"一个带选项的方法":这两件事的**失败语义**不同 ——
   * 选目录取消等于"这次导出算了吧",而选文件取消同样不是错误。但它们要弹的是两种不同的系统
   * 对话框,合成的参数也完全不一样,硬合一个签名只会让两边都别扭。
   */
  chooseSaveFile(input: { suggestedName: string; extension: "png" | "pdf" }): Promise<string | null>;
  /** 写一个文件,需要的目录自动创建。 */
  writeFile(target: string, bytes: Uint8Array): Promise<void>;
  /** 复制一个文件,需要的目录自动创建。 */
  copyFile(from: string, to: string): Promise<void>;
}

/** 真实现:Electron 的目录对话框 + node 的文件写入。 */
export class NodeDesignExporter implements DesignExporter {
  private readonly pickDirectory: () => Promise<string | null>;
  private readonly pickFile: (input: { suggestedName: string; extension: "png" | "pdf" }) => Promise<string | null>;

  constructor(
    pickDirectory: () => Promise<string | null>,
    pickFile: (input: { suggestedName: string; extension: "png" | "pdf" }) => Promise<string | null>,
  ) {
    this.pickDirectory = pickDirectory;
    this.pickFile = pickFile;
  }

  async chooseDirectory(): Promise<string | null> {
    return await this.pickDirectory();
  }

  async chooseSaveFile(input: { suggestedName: string; extension: "png" | "pdf" }): Promise<string | null> {
    return await this.pickFile(input);
  }

  async writeFile(target: string, bytes: Uint8Array): Promise<void> {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  async copyFile(from: string, to: string): Promise<void> {
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
  }
}
