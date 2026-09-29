import { Search, X } from "lucide-react";
import { usePreferences } from "../../shared/preferences";
import type { DesignSortMode } from "./design-recency.ts";

/**
 * 「我的设计」的筛排条:搜索 + 排序 + 计数。
 *
 * ## 为什么搜索是**子串**而不是模糊匹配
 *
 * 这一页的规模是"几十份",而模糊匹配的代价是**用户猜不到为什么某一份没出来**。子串匹配的规则
 * 一句话说得清:「名字或来源里有这几个字」。大小写不敏感,仅此而已。
 *
 * ## 排序为什么只有三项
 *
 * 最近改动(默认,也是回到这一页最常要的)、名字、画面数。别的排序(创建时间、风格)都要新字段
 * 或者新语义,而它们没有对应的真实问题。
 *
 * ## 计数为什么显示"匹配 / 总数"
 *
 * 搜出三条时,"3" 说不清是"一共就三份"还是"筛掉了九份"。两个数一起给,用户才知道自己是不是
 * 应该再改一下关键词。
 */
export function DesignListToolbar({
  matched,
  onQueryChange,
  onSortChange,
  query,
  sort,
  total,
}: {
  matched: number;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: DesignSortMode) => void;
  query: string;
  sort: DesignSortMode;
  total: number;
}) {
  const { t } = usePreferences();
  const sorts: { label: string; mode: DesignSortMode }[] = [
    { label: t("designSortRecent"), mode: "recent" },
    { label: t("designSortName"), mode: "name" },
    { label: t("designSortFrames"), mode: "frames" },
  ];

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[180px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#a8adb2]" />
        <input
          aria-label={t("designSearchLabel")}
          className="h-8 w-full rounded-lg border border-[#e2e4e6] bg-white pl-8 pr-7 text-[12px] text-[#3e3e39] outline-none placeholder:text-[#a8adb2] focus:border-[#c9ccc8] dark:border-[#3b3e41] dark:bg-[#202225] dark:text-foreground"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("designSearchPlaceholder")}
          spellCheck={false}
          type="search"
          value={query}
        />
        {query === "" ? null : (
          <button
            aria-label={t("designSearchClear")}
            className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-[5px] text-[#a8adb2] hover:bg-[#f2f3f2] dark:hover:bg-muted"
            onClick={() => onQueryChange("")}
            type="button"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-0.5 rounded-lg border border-[#e2e4e6] p-0.5 dark:border-[#3b3e41]">
        {sorts.map((item) => (
          <button
            aria-pressed={sort === item.mode}
            className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
              sort === item.mode
                ? "bg-[#252624] text-white dark:bg-[#c4eb58] dark:text-[#202225]"
                : "text-[#8a8f94] hover:bg-[#f2f3f2] dark:hover:bg-muted"
            }`}
            key={item.mode}
            onClick={() => onSortChange(item.mode)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {/*
        只有筛过才显示两个数:没搜的时候"12 / 12"是噪声。
      */}
      <span className="shrink-0 text-[11px] tabular-nums text-[#a8adb2]" data-design-count="">
        {matched === total
          ? t("designCount").replace("{count}", String(total))
          : t("designSearchCount").replace("{matched}", String(matched)).replace("{total}", String(total))}
      </span>
    </div>
  );
}
