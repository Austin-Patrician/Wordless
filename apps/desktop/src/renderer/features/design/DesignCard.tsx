import type { DesignStyleSummaryDto, DesignSummaryDto } from "@wordless/protocol";
import { usePreferences } from "../../shared/preferences";
import { designAccent } from "./design-accent.ts";
import { relativeTimeParts } from "./design-recency.ts";

/**
 * 「我的设计」里的一张卡。
 *
 * ## 为什么是一张**有封面区**的卡,而不是一行文字
 *
 * 设计是**图**。而这一页原来的每一格是「图标 + 名字 + 来源 + N 个画面」—— 用户要从四个字段里
 * 自己认出一份设计。封面区把"哪一份"这件事交回给眼睛。
 *
 * 封面区现在是**这份设计自己的主色**(见 `designAccent`),因为真正的封面要等本机缓存那一层
 * (画布打开过它才有像素)。这一版不是占位:颜色来自这份设计的 `theme.css`,名字压在它上面,
 * 两行之内说清"这是哪一份、长什么样"。缓存接上之后这里换成图,其余部分一字不动。
 *
 * ## 打不开的卡要说清为什么
 *
 * 同一张卡有能点和不能点两种状态,而界面上**必须看得出来** —— 一个长得一样、点了没反应的卡
 * 是这一页最容易让人以为"坏了"的地方。
 */
export function DesignCard({
  cover,
  design,
  onOpen,
  running = false,
  sourceLabel,
  style,
}: {
  /** 本机缓存的封面(这张设计的图)。没有就是没有 —— 用主色块兜底,不是错误状态。 */
  cover?: string | null | undefined;
  design: DesignSummaryDto;
  /** 有这一项才是能点的卡;没有就渲染成静态卡(并把原因写在副标题里)。 */
  onOpen?: (() => void) | undefined;
  /** agent 正在这份设计上干活(只有会话来源能知道这件事)。 */
  running?: boolean;
  /** 「工作区 · 名字」里那一段来源说明。 */
  sourceLabel: string;
  /** 这份设计用的风格(取底色用)。它可能是 null —— agent 手写的设计没有风格。 */
  style: DesignStyleSummaryDto | null | undefined;
}) {
  const { t } = usePreferences();
  const accent = designAccent(style);
  const time = relativeTimeParts(Date.now(), design.updatedAt);

  const relative =
    time.unit === "now"
      ? t("designTimeJustNow")
      : time.unit === "minutes"
        ? t("designTimeMinutes").replace("{count}", String(time.value))
        : time.unit === "hours"
          ? t("designTimeHours").replace("{count}", String(time.value))
          : time.unit === "days"
            ? t("designTimeDays").replace("{count}", String(time.value))
            : t("designTimeUnknown");

  const meta = `${t("designFrameCount").replace("{count}", String(design.frameCount))} · ${relative}`;

  const shell = `group flex w-full flex-col overflow-hidden rounded-xl border border-[#e2e4e6] bg-white text-left dark:border-[#3b3e41] dark:bg-[#202225] ${
    onOpen === undefined ? "" : "transition-all hover:-translate-y-0.5 hover:border-[#c9ccc8] hover:shadow-md"
  }`;

  const body = (
    <>
      <span
        aria-hidden="true"
        className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden px-3"
        // 没风格的设计是正常状态:给一个中性底,而不是一块空白。
        style={{ backgroundColor: accent ?? "#e8e9e4" }}
      >
        {cover === null || cover === undefined ? (
          <span
            className="line-clamp-2 text-center text-[12px] font-medium"
            // 底色可能很深也可能很浅 —— 名字压在它上面必须两种都读得出来。
            style={{ color: readableInk(accent) }}
          >
            {design.name}
          </span>
        ) : (
          // 有封面就用封面:设计是**图**,而这张图是这份设计自己的样子(画布打开它时存的)。
          <img
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
            src={cover}
          />
        )}
        {running ? (
          <span
            className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white"
            data-design-card-running=""
          >
            <span className="size-1.5 animate-pulse rounded-full bg-[#afcb54] motion-reduce:animate-none" />
            {t("designCardRunning")}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
        <span className="truncate text-[12px] font-medium text-[#3e3e39] dark:text-foreground">{design.name}</span>
        <span className="truncate text-[10px] text-[#a8adb2]">
          {meta} · {sourceLabel}
        </span>
      </span>
    </>
  );

  return onOpen === undefined ? (
    <div className={shell} data-design-card={design.name}>
      {body}
    </div>
  ) : (
    <button
      className={`${shell} cursor-pointer text-left`}
      data-design-card={design.name}
      onClick={onOpen}
      title={t("designOpenSession")}
      type="button"
    >
      {body}
    </button>
  );
}

/**
 * 压在底色上的字用什么颜色。
 *
 * 按相对亮度选黑或白,而不是写死白色:风格的主色可能是浅黄(白字读不出来),也可能是深蓝
 * (黑字读不出来)。取不到底色时用深色(那时底色是中性浅色)。
 */
function readableInk(background: string | null): string {
  const rgb = parseHex(background);
  if (rgb === null) return "#3e3e39";
  const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  return luminance > 0.55 ? "#1c1c1e" : "#ffffff";
}

function parseHex(value: string | null): [number, number, number] | null {
  if (value === null) return null;
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (match === null) return null;
  const digits = match[1]!.length === 3 ? [...match[1]!].map((char) => char + char).join("") : match[1]!;
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ];
}
