import { MOCKUP_FRAMES_PER_PAGE, type MockupFramesPerPage, type MockupOptions } from "./mockup-types.ts";

/**
 * 导出设置的默认值、逐字段校验、以及持久化。
 *
 * **设置存在 localStorage,按设计文档为键,不进 `design.json`。**
 *
 * 理由与参考实现一致:导出设置是**本机习惯**,不是设计内容。`design.json` 是画布拥有、
 * agent 读的文件 —— 把「我上次导出时圆角调到了 24」写进去,agent 会把它当设计意图读。
 *
 * 本文件不 import React、不 import Electron。
 */

const STORAGE_PREFIX = "wordless:design-mockup:";

/** 圆角跟着归一化高度走,于是手机稿和桌面稿看起来都对。 */
export const MOCKUP_RADIUS_RATIO = 0.05;

/** 默认每页三个画框:手机稿三连是最常用的一张图,再多就开始压字号了。 */
const DEFAULT_PER_PAGE: MockupFramesPerPage = 3;

export function defaultMockupOptions(normalizedHeight: number): MockupOptions {
  return {
    radius: Math.round(normalizedHeight * MOCKUP_RADIUS_RATIO),
    borderWidth: 12,
    borderColor: "#000000",
    background: "#1C1C1E",
    transparent: false,
    shadow: true,
    brand: true,
    scale: 2,
    perPage: DEFAULT_PER_PAGE,
  };
}

/**
 * 逐字段接受已存设置。
 *
 * **整体校验(少一个字段就整份丢弃)在加字段时会静默清空用户的全部偏好** —— `perPage`
 * 就是后来加的那个字段。所以这里按字段回退,只丢真正不合法的部分。
 */
export function normalizeMockupOptions(raw: unknown, fallback: MockupOptions): MockupOptions {
  if (typeof raw !== "object" || raw === null) return fallback;
  const value = raw as Record<string, unknown>;

  const number = (key: keyof MockupOptions, min: number): number => {
    const candidate = value[key];
    return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= min
      ? candidate
      : (fallback[key] as number);
  };
  const text = (key: keyof MockupOptions): string => {
    const candidate = value[key];
    return typeof candidate === "string" && candidate.trim() !== "" ? candidate : (fallback[key] as string);
  };
  const flag = (key: keyof MockupOptions): boolean => {
    const candidate = value[key];
    return typeof candidate === "boolean" ? candidate : (fallback[key] as boolean);
  };

  return {
    radius: number("radius", 0),
    borderWidth: number("borderWidth", 0),
    borderColor: text("borderColor"),
    background: text("background"),
    transparent: flag("transparent"),
    shadow: flag("shadow"),
    brand: flag("brand"),
    scale: value.scale === 1 || value.scale === 2 ? value.scale : fallback.scale,
    perPage: MOCKUP_FRAMES_PER_PAGE.includes(value.perPage as MockupFramesPerPage)
      ? (value.perPage as MockupFramesPerPage)
      : fallback.perPage,
  };
}

/** 读设置。读不到、或存的全是坏数据,就退回默认值。 */
export function loadMockupOptions(designPath: string, normalizedHeight: number): MockupOptions {
  const fallback = defaultMockupOptions(normalizedHeight);
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_PREFIX + designPath);
    if (!raw) return fallback;
    return normalizeMockupOptions(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
}

export function saveMockupOptions(designPath: string, options: MockupOptions): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_PREFIX + designPath, JSON.stringify(options));
  } catch {
    // 存储写满或被禁用:设置就只是不持久化,不影响这一次导出。
  }
}

/** 导出设置里最大可选的圆角:归一化高度的一半(再大圆角就吞掉整个屏幕)。 */
export function maxMockupRadius(normalizedHeight: number): number {
  return Math.max(8, Math.round(normalizedHeight / 2));
}
