import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { EditorRefPlugin } from "@lexical/react/LexicalEditorRefPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import {
	$applyNodeReplacement,
	$createParagraphNode,
	$createTextNode,
	$getNodeByKey,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isLineBreakNode,
	$isNodeSelection,
	$isRangeSelection,
	$isTextNode,
	$setSelection,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_LOW,
	DecoratorNode,
	KEY_BACKSPACE_COMMAND,
	KEY_DELETE_COMMAND,
	KEY_ENTER_COMMAND,
	SELECTION_CHANGE_COMMAND,
	mergeRegister,
	type EditorState,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	type RangeSelection,
	type SerializedEditorState,
	type SerializedLexicalNode,
	type Spread,
} from "lexical";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { RemoteWorkspaceReference } from "@wordless/remote-control";
import {
	MAX_DRAFT_CHARS,
	MAX_WORKSPACE_REFERENCES,
	mentionQueryAt,
	skillIconText,
	stripTrailingMention,
	type ComposerMentionKind,
} from "./composer";
import { FileTypeIcon } from "./file-type-icon";

/**
 * 输入框的**编辑器**(Lexical)。
 *
 * 为什么不是 `<textarea>` + 一层镜像:textarea 里放不下**行内 token**,而后面要进来的东西
 * (技能、长文本块……)全都是 token。上一版用"两层叠着画"凑出了行内 token 的样子,
 * 但那条路只有底色,放不进图标、也放不进折叠块 —— 每加一种 token 就要重做一次。
 *
 * 这里与桌面端**同一个思路、同一套节点形状**(`DecoratorNode` + `isInline` + `getTextContent() === ""`),
 * 所以两端认出来的东西是一样的:输入框里长什么样、发出去是什么 part、粘到别处是什么文本。
 *
 * 一条纪律:**token 不是文字**。它 `getTextContent()` 是空串 —— 正文归正文、引用归引用,
 * 于是"删掉正文"与"删掉引用"是两件互不影响的事(在编辑器里它们本来就是两个节点)。
 */

type SerializedWorkspaceReferenceNode = Spread<
	{ readonly path: string; readonly name: string; readonly kind: "file" | "directory" },
	SerializedLexicalNode
>;

/**
 * 一个工作区引用(输入框里那枚行内 token)。
 *
 * 与桌面端 `InlineSkillComposer` 里的同名节点**逐条对齐**:同样的类型名、同样的字段、
 * 同样 `getTextContent() === ""`。两边各写一份形状的话,"同一个东西在两端的 part 里长得不一样"
 * 只是时间问题。
 */
class WorkspaceReferenceNode extends DecoratorNode<JSX.Element> {
	__path: string;
	__name: string;
	__kind: "file" | "directory";

	static getType(): string {
		return "wordless-workspace-reference";
	}

	static clone(node: WorkspaceReferenceNode): WorkspaceReferenceNode {
		return new WorkspaceReferenceNode(node.__path, node.__name, node.__kind, node.__key);
	}

	static importJSON(node: SerializedWorkspaceReferenceNode): WorkspaceReferenceNode {
		return $createWorkspaceReferenceNode(node.path, node.name, node.kind);
	}

	constructor(path: string, name: string, kind: "file" | "directory", key?: NodeKey) {
		super(key);
		this.__path = path;
		this.__name = name;
		this.__kind = kind;
	}

	createDOM(): HTMLElement {
		return document.createElement("span");
	}

	decorate(): JSX.Element {
		return <WorkspaceReferenceToken kind={this.__kind} name={this.__name} path={this.__path} />;
	}

	exportJSON(): SerializedWorkspaceReferenceNode {
		return {
			...super.exportJSON(),
			path: this.__path,
			name: this.__name,
			kind: this.__kind,
			type: "wordless-workspace-reference",
			version: 1,
		};
	}

	getPath(): string {
		return this.getLatest().__path;
	}

	getName(): string {
		return this.getLatest().__name;
	}

	getKind(): "file" | "directory" {
		return this.getLatest().__kind;
	}

	/** **空串**:引用不是正文的一部分(见文件头那条纪律)。 */
	getTextContent(): string {
		return "";
	}

	isInline(): true {
		return true;
	}

	isIsolated(): true {
		return true;
	}

	isKeyboardSelectable(): true {
		return true;
	}

	updateDOM(): false {
		return false;
	}
}

function $createWorkspaceReferenceNode(path: string, name: string, kind: "file" | "directory"): WorkspaceReferenceNode {
	return $applyNodeReplacement(new WorkspaceReferenceNode(path, name, kind));
}

function $isWorkspaceReferenceNode(node: LexicalNode | null | undefined): node is WorkspaceReferenceNode {
	return node instanceof WorkspaceReferenceNode;
}

type SerializedSkillTokenNode = Spread<
	{ readonly skillId: string; readonly skillName: string },
	SerializedLexicalNode
>;

/**
 * 一枚技能 token(输入框里的 `$技能`)。
 *
 * 与桌面端的 `SkillTokenNode` **同名、同字段、同一条纪律**(`getTextContent()` 是空串),
 * 差别只有一处:这边不带 `source` —— 远端拿到的技能目录只有 id 与名字,
 * 而"这个技能从哪儿来"由本机解析(远端不必知道,也不该知道)。
 */
class SkillTokenNode extends DecoratorNode<JSX.Element> {
	__skillId: string;
	__skillName: string;

	static getType(): string {
		return "wordless-skill-token";
	}

	static clone(node: SkillTokenNode): SkillTokenNode {
		return new SkillTokenNode(node.__skillId, node.__skillName, node.__key);
	}

	static importJSON(node: SerializedSkillTokenNode): SkillTokenNode {
		return $createSkillTokenNode(node.skillId, node.skillName);
	}

	constructor(skillId: string, skillName: string, key?: NodeKey) {
		super(key);
		this.__skillId = skillId;
		this.__skillName = skillName;
	}

	createDOM(): HTMLElement {
		return document.createElement("span");
	}

	decorate(): JSX.Element {
		return <SkillToken name={this.__skillName} />;
	}

	exportJSON(): SerializedSkillTokenNode {
		return {
			...super.exportJSON(),
			skillId: this.__skillId,
			skillName: this.__skillName,
			type: "wordless-skill-token",
			version: 1,
		};
	}

	getSkillId(): string {
		return this.getLatest().__skillId;
	}

	getSkillName(): string {
		return this.getLatest().__skillName;
	}

	/** **空串**:token 不是正文的一部分(与文件引用同一条纪律)。 */
	getTextContent(): string {
		return "";
	}

	isInline(): true {
		return true;
	}

	isIsolated(): true {
		return true;
	}

	isKeyboardSelectable(): true {
		return true;
	}

	updateDOM(): false {
		return false;
	}
}

function $createSkillTokenNode(skillId: string, skillName: string): SkillTokenNode {
	return $applyNodeReplacement(new SkillTokenNode(skillId, skillName));
}

function $isSkillTokenNode(node: LexicalNode | null | undefined): node is SkillTokenNode {
	return node instanceof SkillTokenNode;
}

/**
 * 一枚技能 token 的样子 —— 与桌面端同一枚芯片:首字图标 + 名字。
 *
 * 底色与文件引用**刻意不同**(那边是绿的,这边是中性灰):一眼分得清"这是个文件"还是"这是个技能"。
 */
function SkillToken({ name }: { readonly name: string }) {
	return (
		<span
			data-composer-skill
			className="ml-1 mr-1.5 inline-flex h-5 max-w-[200px] select-none items-center gap-1 rounded-[5px] border border-[#d7d8d2] bg-[#f5f5f2] px-1.5 align-middle text-[12px] leading-4 font-medium text-[#454640] dark:border-[#4b4c45] dark:bg-[#2b2c27] dark:text-[#deded8]"
			title={name}
		>
			<span
				aria-hidden
				className="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] bg-[#e6e7e1] text-[9px] font-semibold text-[#5b5c55] dark:bg-[#41423b] dark:text-[#d0d1c9]"
			>
				{skillIconText(name)}
			</span>
			<span className="min-w-0 truncate">{name}</span>
		</span>
	);
}

/** 行内 token 的样子:与桌面端同一枚芯片(类型图标 + 名字,完整路径进 `title`)。 */
function WorkspaceReferenceToken({ name, path, kind }: { readonly name: string; readonly path: string; readonly kind: "file" | "directory" }) {
	return (
		<span
			data-composer-token
			// 左右的间距与桌面端**同值**(那边是外圈 `pl-1 pr-1.5`):不留的话文字会紧贴着芯片,
			// 读起来像"这个字和那个文件名是一回事"。内边距也照桌面端(`px-1.5`)。
			className="ml-1 mr-1.5 inline-flex h-5 max-w-[200px] select-none items-center gap-1 rounded-[5px] border border-[#bed7cf] bg-[#eef8f5] px-1.5 align-middle text-[12px] leading-4 font-medium text-[#34574d] dark:border-[#3b675c] dark:bg-[#20332d] dark:text-[#c5e3d9]"
			title={path}
		>
			<FileTypeIcon className="h-3 w-3 [&_svg]:h-3 [&_svg]:w-3" kind={kind} name={name} />
			<span className="min-w-0 truncate">{name}</span>
		</span>
	);
}

/** 一枚技能 token(远端只知道 id 与名字)。 */
export interface ComposerSkill {
	readonly id: string;
	readonly name: string;
}

/** 编辑器读出来的东西(视图要的全在这里)。 */
export interface ComposerEditorValue {
	/** 正文(不含 token —— token 是引用,走另一条路发出去)。 */
	readonly text: string;
	readonly references: readonly RemoteWorkspaceReference[];
	/** 这一轮要用哪些技能(编辑器里的技能 token,按文档顺序)。 */
	readonly skills: readonly ComposerSkill[];
	/** 光标前那个还没写完的 `@` / `$` 的查询串;没有就是 `undefined`。 */
	readonly workspaceQuery?: string;
	readonly skillQuery?: string;
	/**
	 * 草稿(**序列化后的编辑器状态** —— token 也是内容,刷新之后不该变回几个字)。
	 *
	 * 太大时退回纯文本:草稿存储有长度上限,把 JSON 截断会得到一个**读不回来**的草稿,
	 * 那比丢 token 糟得多。
	 */
	readonly draft: string;
}

export interface ComposerEditorHandle {
	getValue(): ComposerEditorValue;
	/** 用纯文本替换内容(发完清空)。 */
	clear(): void;
	/** 把光标前那段 `@…` 换成一枚 token。 */
	insertWorkspaceReference(reference: RemoteWorkspaceReference): void;
	/** 把光标前那段 `$…` 换成一枚 token(从「+」里点进来的没有 `$…`,那就直接插在光标处)。 */
	insertSkill(skill: ComposerSkill): void;
	focus(): void;
}

export interface ComposerEditorProps {
	/** 草稿(上一次序列化的编辑器状态,或者一段纯文本)。 */
	readonly draft?: string;
	readonly placeholder: string;
	readonly disabled: boolean;
	readonly ariaLabel: string;
	readonly onChange: (value: ComposerEditorValue) => void;
	readonly onSubmit: () => void;
	/**
	 * 选择器开着时的按键(上下 / 回车 / Esc)。返回 true 表示这一下被它吃了 ——
	 * 与桌面端同一个约定(那边叫 `onReferencePickerKeyDown`)。
	 */
	readonly onPickerKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => boolean;
}

const DRAFT_PREFIX = "wordless-composer-v1:";

/** 草稿 → 编辑器状态。带前缀的是序列化状态,别的(老草稿、纯文本)一律当正文。 */
function $applyDraft(editor: LexicalEditor, draft: string): void {
	if (draft.startsWith(DRAFT_PREFIX)) {
		try {
			const state = JSON.parse(draft.slice(DRAFT_PREFIX.length)) as SerializedEditorState;
			editor.setEditorState(editor.parseEditorState(state));
			return;
		} catch {
			// 状态读不回来(格式变了、被截断了):当纯文本放进去,至少字还在。
		}
	}
	editor.update(() => {
		const root = $getRoot();
		root.clear();
		const paragraph = $createParagraphNode();
		if (draft.length > 0) paragraph.append($createTextNode(draft));
		root.append(paragraph);
	});
}

/** 插一枚 token:去掉光标前那段触发符、把节点插进去、光标落到它后面(并留住键盘)。 */
function insertToken(
	editor: LexicalEditor,
	selectionRef: { current: RangeSelection | null },
	create: () => LexicalNode,
	kind: ComposerMentionKind,
): void {
	editor.update(() => {
		$restoreSelection(selectionRef.current);
		$stripMentionAtCaret(kind);
		const selection = $getSelection();
		if (!$isRangeSelection(selection)) return;
		const token = create();
		selection.insertNodes([token]);
		$selectAfterInsertedNode(token);
	});
	// 键盘不该收起来:用户下一句往往接着打。
	editor.focus();
}

/** 输入框里现在有几枚某种 token。 */
function countTokens(editor: LexicalEditor, kind: ComposerMentionKind): number {
	return editor.getEditorState().read(() => {
		let count = 0;
		const visit = (node: LexicalNode): void => {
			const matched = kind === "workspace" ? $isWorkspaceReferenceNode(node) : $isSkillTokenNode(node);
			if (matched) {
				count += 1;
				return;
			}
			if ($isElementNode(node)) node.getChildren().forEach(visit);
		};
		$getRoot().getChildren().forEach(visit);
		return count;
	});
}

/** 正文 + 引用,按文档顺序读出来。 */
function $collectValue(editorState: EditorState): {
	readonly text: string;
	readonly references: readonly RemoteWorkspaceReference[];
	readonly skills: readonly ComposerSkill[];
} {
	return editorState.read(() => {
		const text: string[] = [];
		const references: RemoteWorkspaceReference[] = [];
		const skills: ComposerSkill[] = [];
		const visit = (node: LexicalNode): void => {
			if ($isWorkspaceReferenceNode(node)) {
				references.push({ path: node.getPath(), name: node.getName(), kind: node.getKind() });
				return;
			}
			if ($isSkillTokenNode(node)) {
				skills.push({ id: node.getSkillId(), name: node.getSkillName() });
				return;
			}
			if ($isTextNode(node)) {
				text.push(node.getTextContent());
				return;
			}
			if ($isLineBreakNode(node)) {
				text.push("\n");
				return;
			}
			if ($isElementNode(node)) node.getChildren().forEach(visit);
		};
		// 段落之间补一个换行:用户在输入框里按 Shift+Enter 换的那一行要留着。
		$getRoot().getChildren().forEach((child, index) => {
			if (index > 0) text.push("\n");
			visit(child);
		});
		return { text: text.join(""), references, skills };
	});
}

/**
 * 光标前那个还没写完的 `@`。
 *
 * 只认**光标所在那个文本节点**里、光标之前的那一段(与桌面端同一条规则):`@` 必须在行首或空白之后、
 * 查询串里不能有空白。于是 `foo@bar.com` 不会把选择器弹出来。
 */
function $mentionAtCaret(kind: ComposerMentionKind): string | undefined {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) return undefined;
	const node = selection.anchor.getNode();
	if (!$isTextNode(node)) return undefined;
	const before = node.getTextContent().slice(0, selection.anchor.offset);
	return mentionQueryAt(before, before.length, kind);
}

/** 去掉光标前那段 `@…`(选中之后它就不该留在正文里了)。 */
function $stripMentionAtCaret(kind: ComposerMentionKind): void {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
	const node = selection.anchor.getNode();
	if (!$isTextNode(node)) return;
	const value = node.getTextContent();
	const start = stripTrailingMention(value.slice(0, selection.anchor.offset), kind);
	if (start === null) return;
	node.setTextContent(`${value.slice(0, start)}${value.slice(selection.anchor.offset)}`);
	selection.setTextNodeRange(node, start, node, start);
}

/** 输入框里的两种 token(文件引用 / 技能):删、读、数,都按同一套走。 */
function $isTokenNode(node: LexicalNode | null | undefined): node is WorkspaceReferenceNode | SkillTokenNode {
	return $isWorkspaceReferenceNode(node) || $isSkillTokenNode(node);
}

/**
 * 删掉一枚 token,并把光标放到它原来的位置上。
 *
 * 与桌面端同一个写法:删完把光标落在**它原来占的那一格**(而不是跳到末尾),
 * 用户接着退格才会继续删前面的东西,而不是"跳走"。
 */
function $removeTokenAndSelect(node: LexicalNode): void {
	const parent = node.getParent();
	if (!parent || !$isElementNode(parent)) {
		node.remove();
		$getRoot().selectEnd();
		return;
	}
	const offset = node.getIndexWithinParent();
	node.remove();
	parent.select(offset, offset);
}

/** 光标落到刚插进去的那个节点之后。 */
function $selectAfterInsertedNode(node: LexicalNode): void {
	const next = node.getNextSibling();
	if ($isTextNode(next)) next.select(0, 0);
	else if (next) next.selectStart();
	else node.selectNext();
}

/** 上一次的选择:选择器抢走焦点(点一下)之后,插入仍然要落在用户刚才的位置。 */
function $canRestoreSelection(selection: RangeSelection): boolean {
	const pointIsValid = (point: RangeSelection["anchor"]): boolean => {
		const node = $getNodeByKey(point.key);
		if (!node) return false;
		if (point.type === "text") return $isTextNode(node) && point.offset <= node.getTextContentSize();
		return $isElementNode(node) && point.offset <= node.getChildrenSize();
	};
	return pointIsValid(selection.anchor) && pointIsValid(selection.focus);
}

function $restoreSelection(selection: RangeSelection | null): void {
	if (selection && $canRestoreSelection(selection)) $setSelection(selection.clone());
	else $getRoot().selectEnd();
}

/** 回车发送 / Shift+Enter 换行;顺带记住选择。 */
function ComposerCommandsPlugin({
	onSubmitRef,
	selectionRef,
}: {
	readonly onSubmitRef: { current: () => void };
	readonly selectionRef: { current: RangeSelection | null };
}) {
	const [editor] = useLexicalComposerContext();
	useEffect(
		() =>
			mergeRegister(
				editor.registerCommand(
					KEY_ENTER_COMMAND,
					(event) => {
						// 输入法组字中的回车是"选词",不是"发送"。
						if (event?.shiftKey === true || event?.isComposing === true) return false;
						event?.preventDefault();
						onSubmitRef.current();
						return true;
					},
					COMMAND_PRIORITY_HIGH,
				),
				editor.registerCommand(
					SELECTION_CHANGE_COMMAND,
					() => {
						const selection = $getSelection();
						if ($isRangeSelection(selection)) selectionRef.current = selection.clone();
						return false;
					},
					COMMAND_PRIORITY_LOW,
				),
			),
		[editor, onSubmitRef, selectionRef],
	);
	return null;
}

/**
 * 退格 / Delete 删掉**紧挨着**的那枚 token。
 *
 * **少了这一段,token 在输入框里是删不掉的**(用户报过):Lexical 默认的"删一个字符"只认文本,
 * 光标贴在 token 右边时按退格,它找不到可删的字符,于是什么都不发生 —— 看起来就像 token 卡住了。
 * 桌面端同样自己处理这一段(见 `InlineSkillComposer` 里的 `removeAdjacentToken`)。
 */
function ComposerTokenDeletePlugin({ selectionRef }: { readonly selectionRef: { current: RangeSelection | null } }) {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		const removeAdjacentToken = (direction: "backward" | "forward"): boolean => {
			const selection = $getSelection();
			/*
				两种"该删它"的样子,都要管:
				1. token **被选中**(方向键挪到它身上 —— 它是 `isKeyboardSelectable` 的);
				2. 光标**贴着** token(在它右边按退格 / 在它左边按 Delete)。
			*/
			if ($isNodeSelection(selection)) {
				const token = selection.getNodes().find((node) => $isTokenNode(node));
				if (token === undefined) return false;
				$removeTokenAndSelect(token);
				const after = $getSelection();
				if ($isRangeSelection(after)) selectionRef.current = after.clone();
				return true;
			}
			if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
			const point = selection.anchor;
			const node = point.getNode();
			let adjacent: LexicalNode | null = null;
			if (point.type === "text") {
				if (direction === "backward" && point.offset === 0) adjacent = node.getPreviousSibling();
				if (direction === "forward" && point.offset === node.getTextContentSize()) adjacent = node.getNextSibling();
			} else if ($isElementNode(node)) {
				adjacent = node.getChildAtIndex(direction === "backward" ? point.offset - 1 : point.offset);
			}
			if (!$isTokenNode(adjacent)) return false;
			$removeTokenAndSelect(adjacent);
			const next = $getSelection();
			if ($isRangeSelection(next)) selectionRef.current = next.clone();
			return true;
		};
		return mergeRegister(
			editor.registerCommand(
				KEY_BACKSPACE_COMMAND,
				(event) => {
					const removed = removeAdjacentToken("backward");
					if (removed) event?.preventDefault();
					return removed;
				},
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand(
				KEY_DELETE_COMMAND,
				(event) => {
					const removed = removeAdjacentToken("forward");
					if (removed) event?.preventDefault();
					return removed;
				},
				COMMAND_PRIORITY_HIGH,
			),
		);
	}, [editor, selectionRef]);
	return null;
}

/** 只读 / 禁用状态:交给编辑器自己管(它才知道光标该不该出现)。 */
function EditorEditablePlugin({ editable }: { readonly editable: boolean }) {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		editor.setEditable(editable);
	}, [editor, editable]);
	return null;
}

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(function ComposerEditor(
	{ draft, placeholder, disabled, ariaLabel, onChange, onSubmit, onPickerKeyDown },
	ref,
) {
	const editorRef = useRef<LexicalEditor | null>(null);
	const selectionRef = useRef<RangeSelection | null>(null);
	const onChangeRef = useRef(onChange);
	const onSubmitRef = useRef(onSubmit);
	onChangeRef.current = onChange;
	onSubmitRef.current = onSubmit;
	/**
	 * 占位符要不要让开:按**内容**判断,而不是"正文非空" —— 只挑了一个文件也是内容。
	 *
	 * 初值一律 false(草稿回填会在下一帧把它纠正过来):草稿是**序列化后的状态**,
	 * 哪怕里面什么都没有,那串 JSON 也是非空的 —— 按"草稿非空"判断,空输入框上的占位符
	 * 会永远不出现。
	 */
	const [hasContent, setHasContent] = useState(false);

	/** 把编辑器现在的内容读成视图要的形状(正文 / 引用 / 光标前那个 `@` / 草稿)。 */
	const readValue = (editor: LexicalEditor, editorState?: EditorState): ComposerEditorValue => {
		const state = editorState ?? editor.getEditorState();
		const { text, references, skills } = $collectValue(state);
		const { workspaceQuery, skillQuery } = state.read(() => ({
			workspaceQuery: $mentionAtCaret("workspace"),
			skillQuery: $mentionAtCaret("skill"),
		}));
		// 空输入框的草稿是**空串**:草稿存储那条规矩是"空 = 删掉这一条",不该留一串空状态的 JSON。
		const empty = text.length === 0 && references.length === 0 && skills.length === 0;
		const serialized = `${DRAFT_PREFIX}${JSON.stringify(state.toJSON())}`;
		return {
			text,
			references,
			skills,
			...(workspaceQuery === undefined ? {} : { workspaceQuery }),
			...(skillQuery === undefined ? {} : { skillQuery }),
			draft: empty ? "" : serialized.length > MAX_DRAFT_CHARS ? text : serialized,
		};
	};

	/**
	 * 挂载时把草稿放回输入框。
	 *
	 * **只做一次**:之后用户自己的编辑才是真相(每次都回填会把光标顶回开头)。
	 */
	const appliedDraftRef = useRef(false);
	useEffect(() => {
		if (appliedDraftRef.current) return;
		appliedDraftRef.current = true;
		const editor = editorRef.current;
		if (!editor || draft === undefined || draft.length === 0) return;
		$applyDraft(editor, draft);
	}, [draft]);

	useImperativeHandle(ref, () => ({
		getValue() {
			const editor = editorRef.current;
			if (!editor) return { text: "", references: [], skills: [], draft: "" };
			return readValue(editor);
		},
		clear() {
			const editor = editorRef.current;
			if (!editor) return;
			editor.update(() => {
				const root = $getRoot();
				root.clear();
				root.append($createParagraphNode()).selectEnd();
			});
			editor.focus();
		},
		insertWorkspaceReference(reference) {
			const editor = editorRef.current;
			if (!editor || disabled) return;
			// 上限**在插入时**就守住:本机那边超过 20 个会整条拒掉,而那时候用户已经在等回答了。
			if (countTokens(editor, "workspace") >= MAX_WORKSPACE_REFERENCES) return;
			insertToken(editor, selectionRef, () => $createWorkspaceReferenceNode(reference.path, reference.name, reference.kind), "workspace");
		},
		insertSkill(skill) {
			const editor = editorRef.current;
			if (!editor || disabled) return;
			insertToken(editor, selectionRef, () => $createSkillTokenNode(skill.id, skill.name), "skill");
		},
		focus() {
			editorRef.current?.focus();
		},
	}));

	return (
		<div className="relative min-w-0 flex-1">
			<LexicalComposer
				initialConfig={{
					namespace: "wordless-web-composer",
					nodes: [WorkspaceReferenceNode, SkillTokenNode],
					// 出错了就抛出去:这个输入框坏了必须看得见(而不是留一个安静的空白框)。
					onError: (error: Error) => {
						throw error;
					},
				}}
			>
				<PlainTextPlugin
					contentEditable={
						<ContentEditable
							aria-label={ariaLabel}
							className="max-h-40 min-h-[68px] w-full overflow-y-auto px-2 py-2 text-[13px] leading-5 break-words whitespace-pre-wrap text-foreground outline-none"
							onKeyDownCapture={(event) => {
								// 选择器开着时,上下 / 回车 / Esc 都归它 —— 不然回车会直接把消息发出去。
								if (onPickerKeyDown?.(event) === true) {
									event.preventDefault();
									event.stopPropagation();
									event.nativeEvent.stopImmediatePropagation();
								}
							}}
							placeholder={null}
						/>
					}
					placeholder={null}
					ErrorBoundary={LexicalErrorBoundary}
				/>
				{!hasContent ? (
					<span
						aria-hidden
						className="pointer-events-none absolute top-2 left-2 text-[13px] leading-5 text-muted-foreground"
					>
						{placeholder}
					</span>
				) : null}
				<EditorRefPlugin editorRef={editorRef} />
				<HistoryPlugin />
				<EditorEditablePlugin editable={!disabled} />
				<ComposerCommandsPlugin onSubmitRef={onSubmitRef} selectionRef={selectionRef} />
				<ComposerTokenDeletePlugin selectionRef={selectionRef} />
				<OnChangePlugin
					// 光标动一下不该重新上报内容(手机上一次点击会来好几次)。
					ignoreSelectionChange
					onChange={(editorState, editor) => {
						const value = readValue(editor, editorState);
						// **三种内容都算**:只挑了技能(正文与文件引用都空)时占位符也要让开 ——
						// 少了这一项,它就会**压在刚插进来的那枚 token 上**(用户报过)。
						setHasContent(
							value.text.length > 0 || value.references.length > 0 || value.skills.length > 0,
						);
						onChangeRef.current(value);
					}}
				/>
			</LexicalComposer>
		</div>
	);
});

