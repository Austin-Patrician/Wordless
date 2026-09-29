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

/**
 * 这个落点需要**创建**的父目录;`null` = 一个都不用建。
 *
 * 为什么要有这一步:用户可以把文件保存在**盘符根下**(E 盘根目录里的一个 png),那是合法选择,
 * 而"顺手递归建一遍父目录"会把盘符根当成要创建的东西 —— Windows 上对盘符根做 `mkdir`
 * 直接报 `EPERM: operation not permitted, mkdir` —— 路径就是盘符根本身。
 * 于是保存永远失败,而错误信息里那个路径看起来跟用户选的地方也不像。
 *
 * 两道判断都是同一个理由:**根目录和"没有目录"本来就在那儿**,要求系统创建它们不是无害的
 * 冗余,而是会报错的调用。
 */
export function parentDirectoryToCreate(target: string): string | null {
  const directory = path.dirname(target);
  if (directory === path.parse(directory).root) return null;
  if (directory === "." || directory === "") return null;
  return directory;
}

/**
 * 写文件那三件事,收成一个可注入的端口。
 *
 * 注入的理由只有一个,但很实在:**"盘符根不能建"这条规则在真机上才复现** —— Windows 上对
 * `E:\` 做 `mkdir` 直接 EPERM,而测试跑在临时目录里,永远碰不到盘符根。有了这一层,假 fs 可以
 * 照实地对盘符根抛错,那条失败就能被一个测试钉住(见 `design-export.test.ts`)。
 */
export interface ExportFs {
  mkdir(directory: string): Promise<void>;
  writeFile(target: string, bytes: Uint8Array): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
}

const NODE_EXPORT_FS: ExportFs = {
  async mkdir(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true });
  },
  async writeFile(target: string, bytes: Uint8Array): Promise<void> {
    await writeFile(target, bytes);
  },
  async copyFile(from: string, to: string): Promise<void> {
    await copyFile(from, to);
  },
};

/** 真实现:Electron 的目录对话框 + node 的文件写入。 */
export class NodeDesignExporter implements DesignExporter {
  private readonly pickDirectory: () => Promise<string | null>;
  private readonly pickFile: (input: { suggestedName: string; extension: "png" | "pdf" }) => Promise<string | null>;
  private readonly fs: ExportFs;

  constructor(
    pickDirectory: () => Promise<string | null>,
    pickFile: (input: { suggestedName: string; extension: "png" | "pdf" }) => Promise<string | null>,
    fs: ExportFs = NODE_EXPORT_FS,
  ) {
    this.pickDirectory = pickDirectory;
    this.pickFile = pickFile;
    this.fs = fs;
  }

  async chooseDirectory(): Promise<string | null> {
    return await this.pickDirectory();
  }

  async chooseSaveFile(input: { suggestedName: string; extension: "png" | "pdf" }): Promise<string | null> {
    return await this.pickFile(input);
  }

  async writeFile(target: string, bytes: Uint8Array): Promise<void> {
    const directory = parentDirectoryToCreate(target);
    if (directory !== null) await this.fs.mkdir(directory);
    await this.fs.writeFile(target, bytes);
  }

  async copyFile(from: string, to: string): Promise<void> {
    const directory = parentDirectoryToCreate(to);
    if (directory !== null) await this.fs.mkdir(directory);
    await this.fs.copyFile(from, to);
  }
}
