/**
 * 明暗主题。
 *
 * 与桌面端**同一套语义**(`system | light | dark`)与同一份 token(ui-kit 的
 * `:root[data-theme="dark"]`),所以两端切出来的颜色是同一套,不是"看起来差不多"。
 *
 * 手机上这件事不是"锦上添花":默认跟随系统,是因为大多数人在系统里已经设过一次了 ——
 * 让网页端再问一遍,等于把用户已经做过的决定再问一次。
 */

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

/** 存哪个键、存什么值,与桌面端的偏好**不是同一份存储**(一个是文件,一个是 localStorage)。 */
export const THEME_STORAGE_KEY = "wordless.remote.theme";

/**
 * 手机浏览器状态栏的颜色。
 *
 * 与 ui-kit 的 `--background` **同值**:状态栏和页面背景不一样时,那条接缝在手机上非常显眼。
 */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
	light: "#f8f8f6",
	dark: "#141511",
};

export interface ThemeOption {
	readonly value: ThemePreference;
	readonly label: string;
}

/** 三个选项平铺,不做"点一下循环" —— 循环状态是隐藏状态,用户得试两下才知道自己在哪一档。 */
export const THEME_OPTIONS: readonly ThemeOption[] = [
	{ value: "system", label: "跟随系统" },
	{ value: "light", label: "浅色" },
	{ value: "dark", label: "深色" },
];

/** 认不出来的值一律回到 `system`,而不是猜一个(存储里可能是旧版本写的、也可能是人手改的)。 */
export function parseThemePreference(value: unknown): ThemePreference {
	return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
	if (preference === "system") return prefersDark ? "dark" : "light";
	return preference;
}

export function themeLabel(preference: ThemePreference): string {
	return THEME_OPTIONS.find((option) => option.value === preference)?.label ?? "跟随系统";
}

/** 读存储:取不到(隐私模式、被禁)或值不合法时都回到 `system`。 */
export function readThemePreference(storage?: Pick<Storage, "getItem">): ThemePreference {
	if (!storage) return "system";
	try {
		return parseThemePreference(storage.getItem(THEME_STORAGE_KEY));
	} catch {
		return "system";
	}
}

export function writeThemePreference(storage: Pick<Storage, "setItem"> | undefined, preference: ThemePreference): void {
	if (!storage) return;
	try {
		storage.setItem(THEME_STORAGE_KEY, preference);
	} catch {
		// 存不下不是错误:主题照样生效,只是下次打开会回到跟随系统。
	}
}

/** 把主题落到 `<html data-theme>` 上,并同步状态栏颜色。返回实际生效的那一档。 */
export function applyTheme(
	root: { dataset: { theme?: string }; ownerDocument?: Document | null },
	preference: ThemePreference,
	prefersDark: boolean,
): ResolvedTheme {
	const resolved = resolveTheme(preference, prefersDark);
	root.dataset.theme = resolved;
	const meta = root.ownerDocument?.querySelector?.('meta[name="theme-color"]');
	if (meta) meta.setAttribute("content", THEME_COLORS[resolved]);
	return resolved;
}
