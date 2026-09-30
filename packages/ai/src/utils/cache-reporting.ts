import type { CacheUsageReporting } from "../types.ts";

/**
 * 由"provider 这次**给没给**缓存字段"推出观测级别。
 *
 * 关键在于是**按响应判定**而不是按协议写死:同一个协议的不同网关给出的字段并不一致,
 * 而缺字段和给 0 是两件完全不同的事 —— 给 0 是真的没命中,缺字段是我们无从判断。
 *
 * 只有写、没有读这种形状归到 `unavailable`(保守):类型里没有 `write-only`,而把它报成
 * `read-write` 会凭空宣称"这次调用可观测读",那正是我们要避免的错。
 */
export function cacheUsageReportingOf(input: {
	readReported: boolean;
	writeReported: boolean;
}): CacheUsageReporting {
	if (input.readReported && input.writeReported) return "read-write";
	if (input.readReported) return "read-only";
	return "unavailable";
}
