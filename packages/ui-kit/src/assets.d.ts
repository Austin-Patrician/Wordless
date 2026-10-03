/**
 * 图片资源的类型声明。
 *
 * ui-kit 里现在有真的图片资源(供应商图标),而它自己**不依赖 vite** —— 所以不能像应用那样
 * 靠 `vite/client` 拿到 `*.svg` / `*.png` 的声明,只能自己写一份。
 * 两端(vite 构建)导入这些文件拿到的都是**字符串 URL**,这里就按这个事实声明。
 */
declare module "*.png" {
	const source: string;
	export default source;
}

declare module "*.svg" {
	const source: string;
	export default source;
}

/*
 * `?no-inline`:强制**不内联**成 data URL,而是产出独立文件(只有真的显示时才下载)。
 * 供应商图标一共 38 个,内联进首屏等于让每个用户都为 37 个看不到的图标付费。
 * 带查询串的导入是另一套模块名,所以要单独声明一份。
 */
declare module "*.png?no-inline" {
	const source: string;
	export default source;
}

declare module "*.svg?no-inline" {
	const source: string;
	export default source;
}
