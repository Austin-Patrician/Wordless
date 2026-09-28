import { createHash } from "node:crypto";

/**
 * 设计 id ↔ 设计包路径。
 *
 * 存在的理由是**安全**:URL 里只带 id,不带路径,于是"从 URL 构造一个逃出设计包的
 * 路径"在结构上不可能 —— 不是校验得更严,而是没有可注入的东西。
 *
 * id 是路径的哈希而不是随机值:同一份设计在任何时候都得到同一个 id,渲染层刷新后
 * 不需要重新握手;而哈希是单向的,拿不到路径信息。
 */

/** 取 sha256 前 16 位十六进制:足够避免碰撞,又短到能放进 URL。 */
export function designIdFor(designPath: string): string {
  return createHash("sha256").update(normalizeDesignPath(designPath)).digest("hex").slice(0, 16);
}

/** 末尾斜杠与分隔符统一,否则同一份设计会因为写法不同拿到两个 id。 */
export function normalizeDesignPath(designPath: string): string {
  return designPath.replace(/[\\/]+$/, "").replaceAll("\\", "/");
}

export class DesignRegistry {
  private readonly paths = new Map<string, string>();

  /** 登记一个设计包并返回它的 id。重复登记是幂等的。 */
  register(designPath: string): string {
    const id = designIdFor(designPath);
    this.paths.set(id, designPath);
    return id;
  }

  resolve(id: string): string | null {
    return this.paths.get(id) ?? null;
  }

  clear(): void {
    this.paths.clear();
  }

  get size(): number {
    return this.paths.size;
  }
}
