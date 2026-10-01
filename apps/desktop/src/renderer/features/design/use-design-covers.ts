import { useEffect, useState } from "react";
import { readCover } from "./cover-cache.ts";

/**
 * 一次问一批封面。
 *
 * 列表渲染时几十个 key 会同一帧一起发出去,而每一个都是一次 IndexedDB 事务 —— 所以:
 *
 * - 逐条 set,而不是等全部到齐:先到的那几张先显示,不会因为某一条慢就全都不出来;
 * - `cover-cache` 那边把"内存命中 / 查过了 / 在查"三态分开,重复渲染不会重复查。
 *
 * **没有封面不是错误**:返回的 Map 里没有那个 key,卡片用设计主色兜底。
 */
export function useDesignCovers(
  entries: readonly { design: { path: string } }[] | null,
): ReadonlyMap<string, string> {
  const [covers, setCovers] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** 以路径串为依赖:清单每来一个事件都会换掉数组的引用,而路径没变就不该重查。 */
  const paths = entries === null ? "" : entries.map((entry) => entry.design.path).join("\n");

  useEffect(() => {
    const activePaths = new Set(paths === "" ? [] : paths.split("\n"));
    setCovers((current) => {
      let changed = false;
      const next = new Map<string, string>();
      for (const [path, cover] of current) {
        if (activePaths.has(path)) next.set(path, cover);
        else changed = true;
      }
      return changed ? next : current;
    });
    if (paths === "") return;
    let active = true;
    for (const path of paths.split("\n")) {
      void readCover(path).then((cover) => {
        if (!active || cover === null) return;
        // 一张都没变时不要换 Map 的引用(那会让整列重渲染一次)。
        setCovers((current) => {
          if (current.get(path) === cover) return current;
          const next = new Map(current);
          next.set(path, cover);
          return next;
        });
      });
    }
    return () => {
      active = false;
    };
  }, [paths]);

  return covers;
}
