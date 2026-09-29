/**
 * 「最近改动」怎么读。
 *
 * 这一页最常问的问题是"哪份是我昨天改的",而一个绝对时间戳(2025-09-29 14:03)需要用户自己
 * 做减法。相对时间不需要 —— 但它有两个容易做错的地方,所以它住在这里、被测试盯着:
 *
 * 1. **单位要跳到该跳的那一档**。59 分钟还是"59 分钟前",61 分钟就该是"1 小时前";差一分钟
 *    和差一小时在"我刚才动过吗"这个问题上不是同一件事。
 * 2. **一周以前不该再说"N 天前"**。到那个尺度用户心里已经是日期了,"37 天前"只是让他再做一次
 *    换算 —— 所以超过一周就换成日期。
 *
 * 纯函数:不做格式化、不碰 i18n,只回答"该用哪一档、数字是多少"。文案由组件那侧按语言拼
 * (与 `style-grid.ts` 同一条分工)。
 *
 * 本文件不 import React、不 import Electron。
 */

/** 一秒、一分、一小时、一天的毫秒数。 */
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 超过一周就不再说相对时间。
 *
 * 7 天:周末改的那份,周一回来看"3 天前"还算数;再往前就是"上周三"更准。
 */
const RELATIVE_DAYS_LIMIT = 7;

export type RelativeTimeParts =
  | { unit: "now" }
  | { unit: "minutes"; value: number }
  | { unit: "hours"; value: number }
  | { unit: "days"; value: number }
  /** 超过一周:交给调用方按语言格式化这个时间戳。 */
  | { unit: "date"; at: number };

/**
 * @param now 现在(毫秒)。传进来而不是内部取,是为了让边界能被测试钉住。
 * @param at 那个时间(毫秒)。传 0(不知道)时按"很久以前"处理 —— 编排上它会排在最后。
 */
export function relativeTimeParts(now: number, at: number): RelativeTimeParts {
  if (!Number.isFinite(at) || at <= 0) return { unit: "date", at: 0 };
  // 时钟回拨、或者磁盘上有个未来时间戳:当成"刚刚",而不是负数天。
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return { unit: "now" };
  if (elapsed < HOUR) return { unit: "minutes", value: Math.floor(elapsed / MINUTE) };
  if (elapsed < DAY) return { unit: "hours", value: Math.floor(elapsed / HOUR) };
  const days = Math.floor(elapsed / DAY);
  if (days <= RELATIVE_DAYS_LIMIT) return { unit: "days", value: days };
  return { unit: "date", at };
}

/**
 * 列表项里**筛与排**要读的那几个字段。
 *
 * 抽成一个访问器,而不是要求调用方先把条目摊平:列表项本身是"摘要 + 它住在哪个根",而筛/排只
 * 关心这四件事。于是这两个函数保持泛型,不必知道 `DesignLibraryEntry` 长什么样。
 */
export interface DesignListFields {
  frameCount: number;
  name: string;
  /** 来源那一行(工作区 / 会话的名字)。搜索也匹配它 —— "那个会话里的设计"是真实诉求。 */
  source: string;
  updatedAt: number;
}

export type DesignSortMode = "recent" | "name" | "frames";

/**
 * 排。
 *
 * 三种模式都在**同值时退回名字**:顺序必须是确定的(否则同样的磁盘状态可能排出不同的顺序 ——
 * 那是用户眼里的"它自己乱换位",也是测试偶发)。
 */
export function sortDesigns<T>(
  items: readonly T[],
  mode: DesignSortMode,
  read: (item: T) => DesignListFields,
): T[] {
  return [...items].sort((left, right) => {
    const a = read(left);
    const b = read(right);
    if (mode === "recent" && b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    if (mode === "frames" && b.frameCount !== a.frameCount) return b.frameCount - a.frameCount;
    return a.name.localeCompare(b.name);
  });
}

/**
 * 筛。
 *
 * 大小写不敏感的子串匹配,名字与来源都算。不做模糊匹配:**规则一句话说得清**比"多命中几条"
 * 重要 —— 否则用户猜不到为什么某一份没出来。
 *
 * 空查询(或只有空白)返回原样,而不是空数组:那是"没在搜",不是"搜不到"。
 */
export function filterDesigns<T>(
  items: readonly T[],
  query: string,
  read: (item: T) => DesignListFields,
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...items];
  return items.filter((item) => {
    const fields = read(item);
    return fields.name.toLowerCase().includes(needle) || fields.source.toLowerCase().includes(needle);
  });
}
