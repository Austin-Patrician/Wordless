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
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  DecoratorNode,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject } from "react";
import type { SkillSource, UserPromptPart } from "@wordless/domain";
import { FileTypeIcon } from "../../shared/FileTypeIcon";
import { skillIconText } from "../../shared/skill-icon";
import { countSkillTokenOccurrences, normalizeUserPromptParts, uniqueSkillIdsInDocumentOrder } from "./inline-skill-composer-model";

export type InlineSkillToken = {
  id: string;
  name: string;
  source: SkillSource;
};

export type InlineWorkspaceReferenceToken = {
  path: string;
  name: string;
  kind: "file" | "directory";
};

export type InlineSkillComposerValue = {
  parts: UserPromptPart[];
  skillIds: string[];
  skillTokenCounts: Record<string, number>;
  text: string;
  skillQuery: string | null;
  workspaceReferenceCount: number;
  workspaceQuery: string | null;
};

export type InlineSkillComposerHandle = {
  canNavigateHistory(direction: "next" | "previous"): boolean;
  clear(): void;
  focus(): void;
  getCursorRect(): DOMRect | null;
  getValue(): InlineSkillComposerValue;
  insertSkill(skill: InlineSkillToken, options?: { atEnd?: boolean }): void;
  insertWorkspaceReference(reference: InlineWorkspaceReferenceToken): void;
  setValue(parts: readonly UserPromptPart[], options?: { focus?: boolean }): void;
};

type InlineSkillComposerProps = {
  ariaLabel: string;
  className: string;
  disabled?: boolean;
  onChange(value: InlineSkillComposerValue): void;
  onStop?(): void;
  onSubmit(): void;
  placeholder: string;
  readOnly?: boolean;
  stopEnabled?: boolean;
  submitDisabled?: boolean;
  onReferencePickerKeyDown?(event: ReactKeyboardEvent<HTMLDivElement>): boolean;
  placeholderClassName?: string;
};

type SerializedSkillTokenNode = Spread<
  {
    skillId: string;
    skillName: string;
    source: SkillSource;
  },
  SerializedLexicalNode
>;

type SerializedWorkspaceReferenceNode = Spread<
  { path: string; name: string; kind: "file" | "directory" },
  SerializedLexicalNode
>;

class SkillTokenNode extends DecoratorNode<JSX.Element> {
  __skillId: string;
  __skillName: string;
  __source: SkillSource;

  static getType(): string {
    return "wordless-skill-token";
  }

  static clone(node: SkillTokenNode): SkillTokenNode {
    return new SkillTokenNode(node.__skillId, node.__skillName, node.__source, node.__key);
  }

  static importJSON(serializedNode: SerializedSkillTokenNode): SkillTokenNode {
    return $createSkillTokenNode(serializedNode.skillId, serializedNode.skillName, serializedNode.source);
  }

  constructor(skillId: string, skillName: string, source: SkillSource, key?: NodeKey) {
    super(key);
    this.__skillId = skillId;
    this.__skillName = skillName;
    this.__source = source;
  }

  createDOM(): HTMLElement {
    return document.createElement("span");
  }

  decorate(): JSX.Element {
    return <SkillToken nodeKey={this.__key} skillName={this.__skillName} />;
  }

  exportJSON(): SerializedSkillTokenNode {
    return {
      ...super.exportJSON(),
      skillId: this.__skillId,
      skillName: this.__skillName,
      source: this.__source,
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

  getSource(): SkillSource {
    return this.getLatest().__source;
  }

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

function $createSkillTokenNode(skillId: string, skillName: string, source: SkillSource): SkillTokenNode {
  return $applyNodeReplacement(new SkillTokenNode(skillId, skillName, source));
}

function $isSkillTokenNode(node: LexicalNode | null | undefined): node is SkillTokenNode {
  return node instanceof SkillTokenNode;
}

class WorkspaceReferenceNode extends DecoratorNode<JSX.Element> {
  __path: string;
  __name: string;
  __kind: "file" | "directory";

  static getType(): string { return "wordless-workspace-reference"; }
  static clone(node: WorkspaceReferenceNode): WorkspaceReferenceNode { return new WorkspaceReferenceNode(node.__path, node.__name, node.__kind, node.__key); }
  static importJSON(serializedNode: SerializedWorkspaceReferenceNode): WorkspaceReferenceNode { return $createWorkspaceReferenceNode(serializedNode.path, serializedNode.name, serializedNode.kind); }
  constructor(path: string, name: string, kind: "file" | "directory", key?: NodeKey) { super(key); this.__path = path; this.__name = name; this.__kind = kind; }
  createDOM(): HTMLElement { return document.createElement("span"); }
  decorate(): JSX.Element { return <WorkspaceReferenceToken nodeKey={this.__key} name={this.__name} path={this.__path} kind={this.__kind} />; }
  exportJSON(): SerializedWorkspaceReferenceNode { return { ...super.exportJSON(), path: this.__path, name: this.__name, kind: this.__kind, type: "wordless-workspace-reference", version: 1 }; }
  getPath(): string { return this.getLatest().__path; }
  getName(): string { return this.getLatest().__name; }
  getKind(): "file" | "directory" { return this.getLatest().__kind; }
  getTextContent(): string { return ""; }
  isInline(): true { return true; }
  isIsolated(): true { return true; }
  isKeyboardSelectable(): true { return true; }
  updateDOM(): false { return false; }
}

function $createWorkspaceReferenceNode(path: string, name: string, kind: "file" | "directory"): WorkspaceReferenceNode {
  return $applyNodeReplacement(new WorkspaceReferenceNode(path, name, kind));
}

function $isWorkspaceReferenceNode(node: LexicalNode | null | undefined): node is WorkspaceReferenceNode {
  return node instanceof WorkspaceReferenceNode;
}

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

function $canRestoreSelection(selection: RangeSelection): boolean {
  const pointIsValid = (point: RangeSelection["anchor"]): boolean => {
    const node = $getNodeByKey(point.key);
    if (!node) return false;
    if (point.type === "text") {
      return $isTextNode(node) && point.offset <= node.getTextContentSize();
    }
    return $isElementNode(node) && point.offset <= node.getChildrenSize();
  };
  return pointIsValid(selection.anchor) && pointIsValid(selection.focus);
}

function removeToken(editor: LexicalEditor, nodeKey: NodeKey): void {
  editor.update(() => {
    const node = $getNodeByKey(nodeKey);
    if (node) $removeTokenAndSelect(node);
  });
  editor.focus();
}

function SkillToken({ nodeKey, skillName }: { nodeKey: NodeKey; skillName: string }) {
  const [editor] = useLexicalComposerContext();
  return (
    <span className="inline-flex h-7 select-none items-center pl-1 pr-1.5 align-bottom" contentEditable={false}>
      <span className="group inline-flex h-6 max-w-[220px] items-center gap-1 rounded-[5px] border border-[#d7d8d2] bg-[#f5f5f2] px-1.5 font-sans text-[12px] font-medium leading-4 text-[#454640] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition-colors duration-150 hover:border-[#c6c8bd] hover:bg-[#eeeeea] dark:border-[#4b4c45] dark:bg-[#2b2c27] dark:text-[#deded8] dark:hover:border-[#5b5c54] dark:hover:bg-[#31322d]" title={skillName}>
        <button
          aria-label={`Remove ${skillName}`}
          className="relative grid h-4 w-4 shrink-0 place-items-center rounded-[4px] text-[#73746c] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#9da890] dark:text-[#c6c7bf]"
          onClick={() => removeToken(editor, nodeKey)}
          onMouseDown={(event) => event.preventDefault()}
          type="button"
        >
          <span aria-hidden className="grid h-4 w-4 place-items-center rounded-[4px] bg-[#e6e7e1] text-[9px] font-semibold text-[#5b5c55] transition-opacity duration-100 group-hover:opacity-0 group-focus-within:opacity-0 dark:bg-[#41423b] dark:text-[#d0d1c9]">{skillIconText(skillName)}</span>
          <X aria-hidden className="absolute h-3 w-3 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100" />
        </button>
        <span className="min-w-0 truncate">{skillName}</span>
      </span>
    </span>
  );
}

function WorkspaceReferenceToken({ nodeKey, name, path, kind }: { nodeKey: NodeKey; name: string; path: string; kind: "file" | "directory" }) {
  const [editor] = useLexicalComposerContext();
  return (
    <span className="inline-flex h-7 select-none items-center pl-1 pr-1.5 align-bottom" contentEditable={false}>
      <span className="group inline-flex h-6 max-w-[250px] items-center gap-1 rounded-[5px] border border-[#c2d9d1] bg-[#f0f8f5] px-1.5 font-sans text-[12px] font-medium leading-4 text-[#34574d] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition-colors duration-150 hover:border-[#a9cbbf] hover:bg-[#e7f4ef] dark:border-[#3b675c] dark:bg-[#20332d] dark:text-[#c5e3d9] dark:hover:border-[#4a786c] dark:hover:bg-[#274036]" title={path}>
        <button
          aria-label={`Remove ${name}`}
          className="relative grid h-4 w-4 shrink-0 place-items-center rounded-[4px] text-[#5e8278] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#6eaa99] dark:text-[#b9d8ce]"
          onClick={() => removeToken(editor, nodeKey)}
          onMouseDown={(event) => event.preventDefault()}
          type="button"
        >
          <span aria-hidden className="grid h-4 w-4 place-items-center transition-opacity duration-100 group-hover:opacity-0 group-focus-within:opacity-0"><FileTypeIcon className="h-3 w-3 [&_svg]:h-3 [&_svg]:w-3" kind={kind} name={name} /></span>
          <X aria-hidden className="absolute h-3 w-3 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100" />
        </button>
        <span className="min-w-0 truncate">{name}</span>
      </span>
    </span>
  );
}

function editorValue(editorState: EditorState): InlineSkillComposerValue {
  return editorState.read(() => {
    const parts: UserPromptPart[] = [];
    const tokenIds: string[] = [];
    const appendText = (text: string) => {
      if (text) parts.push({ type: "text", text });
    };
    const visit = (node: LexicalNode) => {
      if ($isSkillTokenNode(node)) {
        tokenIds.push(node.getSkillId());
        parts.push({ type: "skill-reference", skillId: node.getSkillId(), name: node.getSkillName(), source: node.getSource() });
        return;
      }
      if ($isWorkspaceReferenceNode(node)) {
        parts.push({ type: "workspace-reference", path: node.getPath(), name: node.getName(), kind: node.getKind() });
        return;
      }
      if ($isElementNode(node)) {
        node.getChildren().forEach(visit);
        return;
      }
      appendText(node.getTextContent());
    };
    const rootChildren = $getRoot().getChildren();
    rootChildren.forEach((node, index) => {
      visit(node);
      if (index < rootChildren.length - 1) appendText("\n");
    });
    const normalizedParts = normalizeUserPromptParts(parts);
    const text = normalizedParts.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
    const atMatch = /(?:^|\s)@([^\s@$]*)$/.exec(text);
    const skillMatch = /(?:^|\s)\$([^\s@$]*)$/.exec(text);
    return {
      parts: normalizedParts,
      skillIds: uniqueSkillIdsInDocumentOrder(tokenIds),
      skillTokenCounts: countSkillTokenOccurrences(tokenIds),
      skillQuery: skillMatch ? skillMatch[1] ?? "" : null,
      text,
      workspaceReferenceCount: normalizedParts.filter((part) => part.type === "workspace-reference").length,
      workspaceQuery: atMatch ? atMatch[1] ?? "" : null,
    };
  });
}

function EditorEditablePlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(editable), [editable, editor]);
  return null;
}

function EditorCommandsPlugin({ onStop, onSubmit, readOnly, selectionRef, stopEnabled, submitDisabled }: { onStop?(): void; onSubmit(): void; readOnly: boolean; selectionRef: MutableRefObject<RangeSelection | null>; stopEnabled: boolean; submitDisabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  const onStopRef = useRef(onStop);
  const onSubmitRef = useRef(onSubmit);
  onStopRef.current = onStop;
  onSubmitRef.current = onSubmit;

  useEffect(() => editor.registerCommand(
    KEY_ENTER_COMMAND,
    (event) => {
      if (readOnly || event?.shiftKey) return false;
      event?.preventDefault();
      if (!submitDisabled) onSubmitRef.current();
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  ), [editor, readOnly, submitDisabled]);

  useEffect(() => {
    const removeAdjacentToken = (direction: "backward" | "forward"): boolean => {
      if (readOnly) return false;
      const selection = $getSelection();
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
      if (!$isSkillTokenNode(adjacent) && !$isWorkspaceReferenceNode(adjacent)) return false;
      $removeTokenAndSelect(adjacent);
      const nextSelection = $getSelection();
      if ($isRangeSelection(nextSelection)) selectionRef.current = nextSelection.clone();
      return true;
    };
    const removeBackspace = editor.registerCommand(KEY_BACKSPACE_COMMAND, (event) => {
      const removed = removeAdjacentToken("backward");
      if (removed) event?.preventDefault();
      return removed;
    }, COMMAND_PRIORITY_HIGH);
    const removeDelete = editor.registerCommand(KEY_DELETE_COMMAND, (event) => {
      const removed = removeAdjacentToken("forward");
      if (removed) event?.preventDefault();
      return removed;
    }, COMMAND_PRIORITY_HIGH);
    return () => {
      removeBackspace();
      removeDelete();
    };
  }, [editor, readOnly, selectionRef]);

  useEffect(() => editor.registerCommand(
    KEY_ESCAPE_COMMAND,
    (event) => {
      if (!stopEnabled || !onStopRef.current) return false;
      event?.preventDefault();
      onStopRef.current();
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  ), [editor, stopEnabled]);

  return null;
}

function SelectionMemoryPlugin({ selectionRef }: { selectionRef: MutableRefObject<RangeSelection | null> }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(
    SELECTION_CHANGE_COMMAND,
    () => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selectionRef.current = selection.clone();
      return false;
    },
    COMMAND_PRIORITY_HIGH,
  ), [editor, selectionRef]);
  return null;
}

const initialConfig = {
  namespace: "wordless-inline-skill-composer",
  nodes: [SkillTokenNode, WorkspaceReferenceNode],
  onError(error: Error): void {
    throw error;
  },
};

export const InlineSkillComposer = forwardRef<InlineSkillComposerHandle, InlineSkillComposerProps>(function InlineSkillComposer(
  { ariaLabel, className, disabled = false, onChange, onStop, onSubmit, placeholder, placeholderClassName, readOnly = false, stopEnabled = false, submitDisabled = false, onReferencePickerKeyDown },
  ref,
) {
  const editorRef = useRef<LexicalEditor | null>(null);
  const selectionRef = useRef<RangeSelection | null>(null);
  const [hasContent, setHasContent] = useState(false);
  const hasContentRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useImperativeHandle(ref, () => ({
    canNavigateHistory(direction) {
      const editor = editorRef.current;
      if (!editor) return false;
      return editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        const root = $getRoot();
        const topLevel = selection.anchor.getNode().getTopLevelElement();
        if (!topLevel) return root.getChildrenSize() <= 1;
        return direction === "previous"
          ? topLevel === root.getFirstChild()
          : topLevel === root.getLastChild();
      });
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
    focus() {
      editorRef.current?.focus();
    },
    getCursorRect() {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return null;
      return selection.getRangeAt(0).getBoundingClientRect();
    },
    getValue() {
      const editor = editorRef.current;
      return editor ? editorValue(editor.getEditorState()) : { parts: [], skillIds: [], skillTokenCounts: {}, skillQuery: null, text: "", workspaceReferenceCount: 0, workspaceQuery: null };
    },
    insertSkill(skill, options) {
      const editor = editorRef.current;
      if (!editor || disabled || readOnly) return;
      editor.update(() => {
        const token = $createSkillTokenNode(skill.id, skill.name, skill.source);
        if (options?.atEnd) {
          const root = $getRoot();
          const lastChild = root.getLastChild();
          const paragraph = lastChild && $isElementNode(lastChild)
            ? lastChild
            : root.append($createParagraphNode());
          paragraph.append(token);
          token.selectNext();
          return;
        }
        const savedSelection = selectionRef.current;
        if (!options?.atEnd && savedSelection && $canRestoreSelection(savedSelection)) {
          $setSelection(savedSelection.clone());
        } else {
          $getRoot().selectEnd();
        }
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          const node = selection.anchor.getNode();
          if (selection.isCollapsed() && $isTextNode(node)) {
            const value = node.getTextContent();
            const prefix = value.slice(0, selection.anchor.offset);
            const match = /(?:^|\s)\$[^\s@$]*$/.exec(prefix);
            if (match) {
              const start = prefix.length - match[0].length + (match[0].startsWith(" ") ? 1 : 0);
              node.setTextContent(`${value.slice(0, start)}${value.slice(selection.anchor.offset)}`);
              selection.setTextNodeRange(node, start, node, start);
            }
          }
          selection.insertNodes([token]);
          token.selectNext();
          return;
        }
        const root = $getRoot();
        const lastChild = root.getLastChild();
        const parent = lastChild && $isElementNode(lastChild) ? lastChild : root.append($createParagraphNode());
        parent.append(token);
        token.selectNext();
      });
      editor.focus();
    },
    insertWorkspaceReference(reference) {
      const editor = editorRef.current;
      if (!editor || disabled || readOnly) return;
      editor.update(() => {
        const savedSelection = selectionRef.current;
        if (savedSelection && $canRestoreSelection(savedSelection)) $setSelection(savedSelection.clone());
        else $getRoot().selectEnd();
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          const node = selection.anchor.getNode();
          if (selection.isCollapsed() && $isTextNode(node)) {
            const value = node.getTextContent();
            const prefix = value.slice(0, selection.anchor.offset);
            const match = /(?:^|\s)@[^\s@]*$/.exec(prefix);
            if (match) {
              const start = prefix.length - match[0].length + (match[0].startsWith(" ") ? 1 : 0);
              node.setTextContent(`${value.slice(0, start)}${value.slice(selection.anchor.offset)}`);
              selection.setTextNodeRange(node, start, node, start);
            }
          }
          const token = $createWorkspaceReferenceNode(reference.path, reference.name, reference.kind);
          selection.insertNodes([token]);
          token.selectNext();
        }
      });
      editor.focus();
    },
    setValue(parts, options) {
      const editor = editorRef.current;
      if (!editor || disabled || readOnly) return;
      const nextHasContent = parts.some(
        (part) => part.type !== "text" || part.text.length > 0,
      );
      hasContentRef.current = nextHasContent;
      setHasContent(nextHasContent);
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        let paragraph = $createParagraphNode();
        root.append(paragraph);
        for (const part of parts) {
          if (part.type === "text") {
            const lines = part.text.split("\n");
            lines.forEach((line, index) => {
              if (index > 0) {
                paragraph = $createParagraphNode();
                root.append(paragraph);
              }
              if (line) paragraph.append($createTextNode(line));
            });
          } else if (part.type === "skill-reference") {
            paragraph.append($createSkillTokenNode(part.skillId, part.name, part.source));
          } else if (part.type === "workspace-reference") {
            paragraph.append($createWorkspaceReferenceNode(part.path, part.name, part.kind));
          }
        }
        root.selectEnd();
      });
      if (options?.focus !== false) editor.focus();
    },
  }), [disabled, readOnly]);

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <PlainTextPlugin
          ErrorBoundary={LexicalErrorBoundary}
          contentEditable={(
            <ContentEditable
              aria-label={ariaLabel}
              className={className}
              onKeyDownCapture={(event) => {
                if (onReferencePickerKeyDown?.(event)) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.nativeEvent.stopImmediatePropagation();
                  return;
                }
                if (event.key === "Escape" && stopEnabled) {
                  event.preventDefault();
                  onStop?.();
                }
              }}
              placeholder={null}
            />
          )}
          placeholder={null}
        />
        {!hasContent ? <span aria-hidden className={`pointer-events-none absolute left-0.5 top-0 text-[16px] font-normal leading-7 text-[#a2a29b] dark:text-muted-foreground ${placeholderClassName ?? ""}`}>{placeholder}</span> : null}
      </div>
      <EditorRefPlugin editorRef={editorRef} />
      <HistoryPlugin />
      <EditorEditablePlugin editable={!disabled && !readOnly} />
      <EditorCommandsPlugin onStop={onStop} onSubmit={onSubmit} readOnly={readOnly} selectionRef={selectionRef} stopEnabled={stopEnabled} submitDisabled={submitDisabled} />
      <SelectionMemoryPlugin selectionRef={selectionRef} />
      <OnChangePlugin
        ignoreSelectionChange
        onChange={(nextEditorState) => {
          const value = editorValue(nextEditorState);
          const nextHasContent = value.text.length > 0 || value.skillIds.length > 0 || value.workspaceReferenceCount > 0;
          if (nextHasContent !== hasContentRef.current) {
            hasContentRef.current = nextHasContent;
            setHasContent(nextHasContent);
          }
          onChangeRef.current(value);
        }}
      />
    </LexicalComposer>
  );
});
