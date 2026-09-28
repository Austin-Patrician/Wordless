import type { DesignDirectoryEntry, DesignFileRef, DesignFileStat, DesignFs } from "../src/main/design/design-fs.ts";
import { isIgnoredDesignPath } from "../src/main/design/design-fs.ts";

/**
 * 内存版 `DesignFs`。
 *
 * 用假实现而不是临时目录,是为了能构造真磁盘上很难稳定复现的情况:**符号链接指向设计包
 * 之外**、产物缺失、路径里有 `..`。这些正是协议必须挡住的东西。
 *
 * 不是 `.test.ts`,所以不会被测试运行器当成一个空测试文件。
 */
export class FakeDesignFs implements DesignFs {
  private readonly files = new Map<string, string>();
  private readonly binary = new Map<string, Uint8Array<ArrayBuffer>>();
  private readonly symlinks = new Map<string, string>();

  putFile(filePath: string, content: string): void {
    this.files.set(normalize(filePath), content);
  }

  putBytes(filePath: string, content: Uint8Array<ArrayBuffer>): void {
    this.binary.set(normalize(filePath), content);
  }

  /** 建一个指向别处的符号链接。用于验证协议会解析真实路径。 */
  putSymlink(linkPath: string, target: string): void {
    this.symlinks.set(normalize(linkPath), target);
  }

  has(filePath: string): boolean {
    const key = normalize(filePath);
    return this.files.has(key) || this.binary.has(key);
  }

  /** 读文本。也覆盖按字节写入的内容(同步渲染根走的是字节路径)。 */
  text(filePath: string): string | undefined {
    const key = normalize(filePath);
    const direct = this.files.get(key);
    if (direct !== undefined) return direct;
    const bytes = this.binary.get(key);
    return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
  }

  async readText(filePath: string): Promise<string> {
    const content = this.files.get(normalize(filePath));
    if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
    return content;
  }

  async readBytes(filePath: string): Promise<Uint8Array<ArrayBuffer>> {
    const key = normalize(filePath);
    const content = this.binary.get(key) ?? encodeUtf8(this.files.get(key));
    if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
    return content;
  }

  /**
   * 文本与字节两套存储必须互斥 —— **一个路径只有一份内容**。
   *
   * 不互斥的话,`putFile` 之后再 `writeBytes` 会留下两份,而 `text()` 先看文本那份,
   * 于是"写进去了没有"读出来是"没有"。真磁盘上不存在这种状态,所以那不是被测代码的
   * 行为,是假实现自己造出来的第三种可能。
   */
  async writeText(filePath: string, content: string): Promise<void> {
    const key = normalize(filePath);
    this.binary.delete(key);
    this.files.set(key, content);
  }

  async writeBytes(filePath: string, content: Uint8Array): Promise<void> {
    const key = normalize(filePath);
    this.files.delete(key);
    this.binary.set(key, Uint8Array.from(content));
  }

  async listFiles(root: string): Promise<DesignFileRef[]> {
    const base = normalize(root);
    const found: DesignFileRef[] = [];
    for (const key of [...this.files.keys(), ...this.binary.keys()]) {
      if (!key.startsWith(`${base}/`)) continue;
      const relPath = key.slice(base.length + 1);
      if (isIgnoredDesignPath(relPath)) continue;
      found.push({ path: key, relPath });
    }
    return found.sort((left, right) => left.relPath.localeCompare(right.relPath));
  }

  async listDirectory(directory: string): Promise<DesignDirectoryEntry[]> {
    const base = normalize(directory);
    const names = new Map<string, DesignDirectoryEntry>();
    for (const key of [...this.files.keys(), ...this.binary.keys()]) {
      if (!key.startsWith(`${base}/`)) continue;
      const rest = key.slice(base.length + 1);
      const [head] = rest.split("/");
      if (head === undefined || head === "") continue;
      const isDirectory = rest.includes("/");
      const path = `${base}/${head}`;
      if (!names.has(head)) names.set(head, { name: head, path, isDirectory });
    }
    return [...names.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async stat(target: string): Promise<DesignFileStat | null> {
    const key = normalize(target);
    if (this.files.has(key) || this.binary.has(key)) return { isDirectory: false, isFile: true };
    if (this.symlinks.has(key)) {
      const resolved = this.resolveSymlink(key);
      return resolved === null ? null : await this.stat(resolved);
    }
    const prefix = `${key}/`;
    for (const candidate of [...this.files.keys(), ...this.binary.keys()]) {
      if (candidate.startsWith(prefix)) return { isDirectory: true, isFile: false };
    }
    return null;
  }

  async ensureDirectory(): Promise<void> {
    // 内存实现里目录由文件路径隐含,不需要真的建。
  }

  async remove(target: string): Promise<void> {
    const key = normalize(target);
    const prefix = `${key}/`;
    for (const candidate of [...this.files.keys()]) {
      if (candidate === key || candidate.startsWith(prefix)) this.files.delete(candidate);
    }
    for (const candidate of [...this.binary.keys()]) {
      if (candidate === key || candidate.startsWith(prefix)) this.binary.delete(candidate);
    }
    this.symlinks.delete(key);
  }

  /**
   * 改名。**目录也支持** —— 构建器的原子切换搬的就是目录。
   *
   * 内存实现里目录不是实体、只是文件路径的前缀,所以"搬目录"必须自己展开成搬它下面的
   * 每一个文件。只处理单个文件的话,构建器的切换在这里会静默成功而什么都没动,
   * 测试就会变成一句空话。
   */
  async rename(from: string, to: string): Promise<void> {
    const source = normalize(from);
    const target = normalize(to);

    const moved: [Map<string, unknown>, string, unknown][] = [];
    const prefix = `${source}/`;
    let found = false;
    for (const [map, key] of this.keysWith(source, prefix)) {
      found = true;
      moved.push([map, key, map.get(key)]);
    }
    if (!found) throw new Error(`ENOENT: ${from}`);

    for (const [map, key] of this.keysWith(source, prefix)) map.delete(key);
    for (const [map, key, value] of moved) map.set(target + key.slice(source.length), value);
  }

  /** 源本身以及它下面的一切。目录与文件在这里没有区别。 */
  private keysWith(source: string, prefix: string): [Map<string, unknown>, string][] {
    const found: [Map<string, unknown>, string][] = [];
    for (const map of [this.files, this.binary] as Map<string, unknown>[]) {
      for (const key of [...map.keys()]) {
        if (key === source || key.startsWith(prefix)) found.push([map, key]);
      }
    }
    return found;
  }

  /** 解析符号链接。这正是协议用来戳穿"字面路径在包内、真实路径在包外"的手段。 */
  async realpath(target: string): Promise<string> {
    const resolved = this.resolveSymlink(normalize(target));
    if (resolved === null) throw new Error(`ENOENT: ${target}`);
    return resolved;
  }

  private resolveSymlink(key: string): string | null {
    const target = this.symlinks.get(key);
    if (target === undefined) return key;
    // 链接目标可以是相对的,相对链接所在目录解析。
    if (target.startsWith("/")) return normalize(target);
    const directory = key.slice(0, key.lastIndexOf("/"));
    return normalize(`${directory}/${target}`);
  }
}

/** 归一化:折叠重复分隔符,解掉 `.` 与 `..`,去尾斜杠。 */
export function normalize(input: string): string {
  const absolute = input.startsWith("/");
  const parts: string[] = [];
  for (const segment of input.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}

function encodeUtf8(content: string | undefined): Uint8Array<ArrayBuffer> | undefined {
  return content === undefined ? undefined : (new TextEncoder().encode(content) as Uint8Array<ArrayBuffer>);
}
