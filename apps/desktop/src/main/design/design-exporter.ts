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
  /** 写一个文件,需要的目录自动创建。 */
  writeFile(target: string, bytes: Uint8Array): Promise<void>;
  /** 复制一个文件,需要的目录自动创建。 */
  copyFile(from: string, to: string): Promise<void>;
}

/** 真实现:Electron 的目录对话框 + node 的文件写入。 */
export class NodeDesignExporter implements DesignExporter {
  private readonly pick: () => Promise<string | null>;

  constructor(pick: () => Promise<string | null>) {
    this.pick = pick;
  }

  async chooseDirectory(): Promise<string | null> {
    return await this.pick();
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
