import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	THEME_OPTIONS,
	THEME_STORAGE_KEY,
	applyTheme,
	parseThemePreference,
	readThemePreference,
	resolveTheme,
	themeLabel,
	writeThemePreference,
} from "../src/theme.ts";

/**
 * 主题的三条纪律:**认不出来的值不猜**、**跟随系统要真的跟着系统**、**首帧不闪**。
 * 前两条在这里测;第三条由 `index.html` 里的内联脚本保证(它在 React 之前跑)。
 */

const fakeStorage = (initial: Record<string, string> = {}) => {
	const map = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value),
		map,
	};
};

describe("主题偏好", () => {
	it("认不出来的值回到跟随系统,而不是猜一个", () => {
		assert.equal(parseThemePreference("dark"), "dark");
		assert.equal(parseThemePreference("light"), "light");
		assert.equal(parseThemePreference("system"), "system");
		assert.equal(parseThemePreference("neon"), "system");
		assert.equal(parseThemePreference(null), "system");
		assert.equal(parseThemePreference(undefined), "system");
	});

	it("跟随系统时真的跟着系统走", () => {
		assert.equal(resolveTheme("system", true), "dark");
		assert.equal(resolveTheme("system", false), "light");
	});

	it("手动选的那一档不受系统影响", () => {
		assert.equal(resolveTheme("dark", false), "dark");
		assert.equal(resolveTheme("light", true), "light");
	});

	it("每个选项都有中文标签(状态不只靠图标)", () => {
		assert.deepEqual(
			THEME_OPTIONS.map((option) => option.label),
			["跟随系统", "浅色", "深色"],
		);
		assert.equal(themeLabel("dark"), "深色");
	});
});

describe("主题存储", () => {
	it("存了就读得回来", () => {
		const storage = fakeStorage();
		writeThemePreference(storage, "dark");
		assert.equal(storage.map.get(THEME_STORAGE_KEY), "dark");
		assert.equal(readThemePreference(storage), "dark");
	});

	it("存储里是坏值时回到跟随系统", () => {
		assert.equal(readThemePreference(fakeStorage({ [THEME_STORAGE_KEY]: "neon" })), "system");
	});

	it("存储不可用(隐私模式)时不炸,只是回到跟随系统", () => {
		const hostile = {
			getItem: () => {
				throw new Error("blocked");
			},
		};
		assert.equal(readThemePreference(hostile), "system");
		assert.doesNotThrow(() => writeThemePreference(undefined, "dark"));
	});
});

describe("应用到页面上", () => {
	it("跟随系统时按系统偏好落到 data-theme", () => {
		const root = { dataset: {} as { theme?: string } };
		assert.equal(applyTheme(root, "system", true), "dark");
		assert.equal(root.dataset.theme, "dark");
	});

	it("同时同步手机状态栏颜色(与页面背景同值,不留接缝)", () => {
		const attributes = new Map<string, string>();
		const meta = { setAttribute: (name: string, value: string) => void attributes.set(name, value) };
		const root = {
			dataset: {} as { theme?: string },
			ownerDocument: { querySelector: () => meta } as unknown as Document,
		};
		applyTheme(root, "dark", false);
		assert.equal(attributes.get("content"), "#141511");
		applyTheme(root, "light", false);
		assert.equal(attributes.get("content"), "#f8f8f6");
	});

	it("没有 meta 标签时也不炸", () => {
		const root = { dataset: {} as { theme?: string }, ownerDocument: null };
		assert.doesNotThrow(() => applyTheme(root, "dark", false));
	});
});
