/**
 * 新建会话页需要的**那几个词**。
 *
 * 工作类型的名字在渲染层是 i18n key(`entryGeneralWork` 之类),而主进程没有那套表 ——
 * 这里是同一套做法:`notifications/copy.ts` 也是"主进程只需要几个词,不搬一整套 i18n 框架"。
 *
 * 远端目前只有中文界面(与网页端其它文案一致),所以这张表也只有中文。
 * **键名与渲染层逐字对齐**:改了那边就要改这边,漏了会显示成原始 key(一眼看得出来)。
 */
const ENTRY_LABELS: Record<string, { readonly name: string; readonly description: string }> = {
	entryGeneralWork: { name: "通用工作", description: "日常写作、研究与综合任务。" },
	entryPresentation: { name: "演示文稿", description: "创建和优化演示文稿。" },
	entrySpreadsheet: { name: "电子表格", description: "处理工作簿、公式和报表。" },
	entryDataAnalysis: { name: "数据分析", description: "清洗、分析和解释数据。" },
	entryCodeDevelopment: { name: "代码开发", description: "理解、实现与调试代码。" },
	entryUiDesign: { name: "UI 设计", description: "设计界面与产品体验。" },
	entryImageGeneration: { name: "图片生成", description: "生成与编辑图片。" },
};

/** 名字与一句话说明:查不到就**如实回落到 key**,而不是编一个。 */
export function entryCopy(labelKey: string, descriptionKey: string): { readonly name: string; readonly description: string } {
	const copy = ENTRY_LABELS[labelKey];
	return {
		name: copy?.name ?? labelKey,
		description: copy?.description ?? descriptionKey,
	};
}
