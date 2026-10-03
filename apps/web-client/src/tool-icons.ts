import {
	Camera,
	CornerDownLeft,
	ListTree,
	Pointer,
	SquareStack,
	SquareTerminal,
	TextCursorInput,
	Wrench,
} from "lucide-react";
import dataAnalysisIcon from "./icons/common-icons/数据分析.svg";
import dataPublishIcon from "./icons/common-icons/data_publish.svg";
import dataValidateIcon from "./icons/common-icons/data_validate.svg";
import deepThinkingIcon from "./icons/common-icons/深度思考.svg";
import delegateTaskIcon from "./icons/common-icons/delegate_task.svg";
import designCreateIcon from "./icons/common-icons/design_create.svg";
import designExportIcon from "./icons/common-icons/design_export.svg";
import designFramesIcon from "./icons/common-icons/design_frames.svg";
import designInspectIcon from "./icons/common-icons/design_inspect.svg";
import designScreenshotIcon from "./icons/common-icons/design_screenshot.svg";
import designStatusIcon from "./icons/common-icons/design_status.svg";
import designStyleApplyIcon from "./icons/common-icons/design_style_apply.svg";
import designStyleListIcon from "./icons/common-icons/design_style_list.svg";
import editIcon from "./icons/common-icons/edit.svg";
import extractTextFromImageIcon from "./icons/common-icons/extract_text_from_image.svg";
import findIcon from "./icons/common-icons/find.svg";
import folderIcon from "./icons/common-icons/floder.svg";
import grepIcon from "./icons/common-icons/grep.svg";
import innovationIcon from "./icons/common-icons/innovation.svg";
import modelRequestIcon from "./icons/common-icons/模型请求.svg";
import listIcon from "./icons/common-icons/list.svg";
import loadSkillIcon from "./icons/common-icons/load_skill.svg";
import planIcon from "./icons/common-icons/plan.svg";
import readFileIcon from "./icons/common-icons/read_file.svg";
import readIcon from "./icons/common-icons/read.svg";
import researchSnapshotIcon from "./icons/common-icons/research_snapshot.svg";
import researchSubmitDimensionIcon from "./icons/common-icons/research_submit_dimension.svg";
import researchValidateIcon from "./icons/common-icons/research_validate.svg";
import terminalBashIcon from "./icons/common-icons/terminal-bash.svg";
import updatePlanIcon from "./icons/common-icons/update-plan.svg";
import writeIcon from "./icons/common-icons/Write.svg";

/**
 * 工具图标 —— **与桌面端同一张表、同一批 SVG**。
 *
 * 直接照抄 `features/workbench/renderer-registry.tsx` 的 `standardToolIconSources`:
 * 远端看到的工具名与本机完全一样,所以"同一个工具在两端长得一样"只是把表搬过来而已。
 *
 * 两类来源:
 * - **自绘 SVG**(`icons/common-icons/*.svg`,从桌面端复制):这些是产品自己的图标语言。
 * - **lucide**(浏览器工具那一组):桌面端也用 lucide,并且**刻意避开**浏览器面板工具栏已用的字形 ——
 *   `browser_click` 用 `Pointer` 而不是 `MousePointerClick`,因为后者在面板里表示"允许操作",两件事不该共用一个图标。
 */

export type ToolIconSource =
	| { readonly kind: "image"; readonly src: string; readonly invertOnDark: boolean }
	| { readonly kind: "component"; readonly Icon: typeof Wrench };

const image = (src: string, invertOnDark = true): ToolIconSource => ({ kind: "image", src, invertOnDark });
const component = (Icon: typeof Wrench): ToolIconSource => ({ kind: "component", Icon });

const TOOL_ICONS: Record<string, ToolIconSource> = {
	ask_clarifying_question: image(innovationIcon),
	bash: image(terminalBashIcon),
	browser_click: component(Pointer),
	browser_console: component(SquareTerminal),
	browser_press: component(CornerDownLeft),
	browser_screenshot: component(Camera),
	browser_snapshot: component(ListTree),
	browser_tabs: component(SquareStack),
	browser_type: component(TextCursorInput),
	complete_clarification: image(innovationIcon),
	data_catalog: image(folderIcon),
	data_inspect: image(readFileIcon),
	data_materialize: { kind: "image", src: dataAnalysisIcon, invertOnDark: false },
	data_publish: { kind: "image", src: dataPublishIcon, invertOnDark: false },
	data_validate: image(dataValidateIcon),
	delegate_task: { kind: "image", src: delegateTaskIcon, invertOnDark: false },
	delegate_expert: { kind: "image", src: delegateTaskIcon, invertOnDark: false },
	design_create: image(designCreateIcon),
	design_export: image(designExportIcon),
	design_frames: image(designFramesIcon),
	design_inspect: image(designInspectIcon),
	design_screenshot: image(designScreenshotIcon),
	design_status: image(designStatusIcon),
	design_style_apply: image(designStyleApplyIcon),
	design_style_list: image(designStyleListIcon),
	edit: image(editIcon),
	extract_text_from_image: image(extractTextFromImageIcon),
	find: image(findIcon),
	grep: image(grepIcon),
	load_skill: image(loadSkillIcon),
	ls: image(listIcon),
	read: image(readIcon),
	read_file: image(readFileIcon),
	research_prepare: image(planIcon),
	research_review_dimension: { kind: "image", src: researchValidateIcon, invertOnDark: false },
	research_snapshot: image(researchSnapshotIcon),
	research_start: { kind: "image", src: deepThinkingIcon, invertOnDark: false },
	research_submit_dimension: image(researchSubmitDimensionIcon),
	research_validate: { kind: "image", src: researchValidateIcon, invertOnDark: false },
	request_user_input: { kind: "image", src: modelRequestIcon, invertOnDark: false },
	update_plan: image(updatePlanIcon),
	workspace_changes: image(listIcon),
	write: image(writeIcon),
};

/** 找不到就退到扳手 —— 与桌面端同一个兜底,所以"没见过的工具"两端也一样。 */
export function toolIcon(name: string): ToolIconSource {
	return TOOL_ICONS[name] ?? component(Wrench);
}

/** MCP 工具(`mcp_*`)在桌面端走扩展那一套;远端只做对话,统一用扳手。 */
export function toolIconName(name: string): string {
	return name.startsWith("mcp_") ? "mcp" : name;
}
