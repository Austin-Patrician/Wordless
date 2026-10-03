import type { RemoteConnectorSummary, RemoteModelOption, RemoteSessionSummary } from "@wordless/remote-control";

/**
 * 输入区那一行控件:显示什么、点了打开什么、哪些能改。
 *
 * **与桌面端同一套信息**:桌面端的输入区是一张卡片,底下排着「+ / 权限 / 连接器 / 模型 / 发送」。
 * 手机放不下这些文字标签,所以这里改成**图标按钮 + 抽屉** —— 信息量一样,只是换了个摆法。
 *
 * **三样都能改**:模型、权限(访问权限 + 工具确认)、连接器。
 * 权限与连接器曾经是只读的(它们确实是安全边界);产品决定放开之后,这里的边界变成了
 * **本机校验 + 一条条明确的可选值**:认不出来的值一律不发,连接器只能在**已启用**的里面挑。
 */

export type ComposerControlKind = "permissions" | "connectors" | "model" | "more";

export interface ComposerControl {
	readonly kind: ComposerControlKind;
	/** 无障碍标签与 title(图标按钮上唯一能读的文字)。 */
	readonly label: string;
	/** 按钮上那点文字:模型名、连接器数量。没有就是纯图标。 */
	readonly value?: string;
	/** 能不能改。不能改的点了只解释。 */
	readonly editable: boolean;
	/**
	 * 供应商身份(只有模型这个控件有):用来挑图标。
	 *
	 * 只认"名字"(像 `"anthropic"`),与桌面端 `ProviderIcon` 吃的是同两个字段 ——
	 * 所以两端认出的是同一个标志,不需要各自维护一张表。
	 */
	readonly providerId?: string;
	readonly avatarId?: string;
}

const ACCESS_LABELS: Record<string, string> = { default: "默认权限", full: "完全访问" };
const APPROVAL_LABELS: Record<string, string> = { manual: "手动确认", auto: "自动执行", bypass: "跳过确认" };

/** 权限那一个按钮上的短标签:优先说"工具确认",因为它更常影响用户的判断。 */
export function permissionLabel(session: RemoteSessionSummary | undefined): string | undefined {
	if (!session) return undefined;
	const approval = session.toolApprovalMode === undefined ? undefined : APPROVAL_LABELS[session.toolApprovalMode];
	const access = session.accessLevel === undefined ? undefined : ACCESS_LABELS[session.accessLevel];
	return approval ?? access;
}

export function composerControls(input: {
	readonly session: RemoteSessionSummary | undefined;
	readonly models: readonly RemoteModelOption[] | undefined;
	readonly running: boolean;
}): readonly ComposerControl[] {
	const { session, models, running } = input;
	const controls: ComposerControl[] = [];
	controls.push({
		kind: "permissions",
		label: "权限",
		...(permissionLabel(session) === undefined ? {} : { value: permissionLabel(session) as string }),
		// 正在回复时本机会拒绝:界面先如实关掉。
		editable: session !== undefined && !running,
	});
	const connectorCount = session?.connectors?.length ?? session?.connectorCount ?? 0;
	controls.push({
		kind: "connectors",
		label: "连接器",
		...(connectorCount === 0 ? {} : { value: String(connectorCount) }),
		editable: session !== undefined && !running,
	});
	controls.push({
		kind: "model",
		label: "模型",
		...(session?.modelName === undefined ? {} : { value: session.modelName }),
		// 正在回复时换模型会被本机拒绝:按钮就如实关掉,而不是让用户点了再被拒。
		editable: models !== undefined && models.length > 0 && !running,
	});
	controls.push({ kind: "more", label: "更多", editable: false });
	return controls;
}

export interface ComposerMoreEntry {
	readonly key: string;
	readonly label: string;
	/** 远端能用就 true;否则给一句"为什么不能" —— 空着比说假话好。 */
	readonly available: boolean;
	readonly hint?: string;
}

/**
 * 「+」里有什么。
 *
 * 桌面端那一个「+」后面是模式、技能、附件、计划…… **远端一个都做不了** ——
 * 远端只做对话。但把它列出来并说明为什么,比藏起来好:用户至少知道"这不是坏了,是这里不做"。
 */
export const COMPOSER_MORE_ENTRIES: readonly ComposerMoreEntry[] = [
	{ key: "skills", label: "技能", available: false, hint: "技能要在电脑上选:它决定这一轮用哪些能力。" },
	{ key: "attachments", label: "附件", available: false, hint: "附件要在电脑上添加:手机上传体积与类型都难控制。" },
	{ key: "mode", label: "计划模式", available: false, hint: "执行模式是安全边界,只能在电脑上改。" },
];

/** 连接器抽屉里的行:名字 + 开没开。**没有开关** —— 远端不能改。 */
export function connectorRows(
	connectors: readonly RemoteConnectorSummary[] | undefined,
): readonly { readonly id: string; readonly name: string; readonly enabled: boolean }[] {
	return (connectors ?? []).map((connector) => ({
		id: connector.id,
		name: connector.name,
		enabled: connector.enabled,
	}));
}

/** 访问权限的可选值(**与协议白名单一一对应**;认不出来的值不发)。 */
export const ACCESS_OPTIONS: readonly { readonly value: "default" | "full"; readonly label: string }[] = [
	{ value: "default", label: "默认权限" },
	{ value: "full", label: "完全访问" },
];

/** 工具确认的可选值。三个都给 —— 与桌面端同样的全量选择。 */
export const APPROVAL_OPTIONS: readonly { readonly value: "manual" | "auto" | "bypass"; readonly label: string }[] = [
	{ value: "manual", label: "手动确认" },
	{ value: "auto", label: "自动执行" },
	{ value: "bypass", label: "跳过确认" },
];

/** 连接器抽屉里的可选行:只列**已启用**的(本机也只接受已启用的)。 */
export function selectableConnectors(
	connectors: readonly RemoteConnectorSummary[] | undefined,
): readonly { readonly id: string; readonly name: string; readonly selected: boolean }[] {
	return (connectors ?? []).map((connector) => ({
		id: connector.id,
		name: connector.name,
		selected: connector.enabled,
	}));
}

/** 交互模式的可选值(**与协议白名单一一对应**)。 */
export const MODE_OPTIONS: readonly { readonly value: "default" | "plan" | "clarify"; readonly label: string }[] = [
	{ value: "default", label: "默认" },
	{ value: "plan", label: "计划" },
	{ value: "clarify", label: "澄清" },
];
