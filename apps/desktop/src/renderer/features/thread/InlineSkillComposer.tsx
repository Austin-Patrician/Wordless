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
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
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
import { Command, X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type JSX, type MutableRefObject } from "react";
import type { SkillSource, UserPromptPart } from "@wordless/domain";
import { countSkillTokenOccurrences, normalizeUserPromptParts, uniqueSkillIdsInDocumentOrder } from "./inline-skill-composer-model";

export type InlineSkillToken = {
  id: string;
  name: string;
  source: SkillSource;
};

export type InlineSkillComposerValue = {
  parts: UserPromptPart[];
  skillIds: string[];
  skillTokenCounts: Record<string, number>;
  text: string;
};

export type InlineSkillComposerHandle = {
  clear(): void;
  focus(): void;
  insertSkill(skill: InlineSkillToken): void;
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
};

type SerializedSkillTokenNode = Spread<
  {
    skillId: string;
    skillName: string;
    source: SkillSource;
  },
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

function SkillToken({ nodeKey, skillName }: { nodeKey: NodeKey; skillName: string }) {
  const [editor] = useLexicalComposerContext();
  return (
    <span className="group mx-1.5 inline-flex h-7 max-w-[210px] select-none items-center gap-1 rounded-[6px] border border-[#deded9] bg-[#f1f1ef] px-2 align-middle font-sans text-[16px] font-normal leading-7 text-[#45453f] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:border-[#4b4c45] dark:bg-[#2b2c27] dark:text-[#deded8]" contentEditable={false}>
      <Command aria-hidden className="h-3.5 w-3.5 shrink-0 text-[#686861] dark:text-[#b7b8ae]" />
      <span className="min-w-0 truncate">{skillName}</span>
      <button
        aria-label={`Remove ${skillName}`}
        className="grid h-4 w-4 shrink-0 place-items-center rounded-[3px] text-[#777770] opacity-0 pointer-events-none transition-opacity group-focus-within:opacity-100 group-focus-within:pointer-events-auto group-hover:opacity-100 group-hover:pointer-events-auto hover:bg-[#ddddda] hover:text-[#22221f] dark:hover:bg-[#464740] dark:hover:text-white"
        onClick={() => editor.update(() => $getNodeByKey(nodeKey)?.remove())}
        onMouseDown={(event) => event.preventDefault()}
        type="button"
      >
        <X className="h-3 w-3" />
      </button>
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
    return {
      parts: normalizedParts,
      skillIds: uniqueSkillIdsInDocumentOrder(tokenIds),
      skillTokenCounts: countSkillTokenOccurrences(tokenIds),
      text: normalizedParts.flatMap((part) => part.type === "text" ? [part.text] : []).join(""),
    };
  });
}

function EditorEditablePlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(editable), [editable, editor]);
  return null;
}

function EditorCommandsPlugin({ onStop, onSubmit, readOnly, selectionRef }: { onStop?(): void; onSubmit(): void; readOnly: boolean; selectionRef: MutableRefObject<RangeSelection | null> }) {
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
      onSubmitRef.current();
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  ), [editor, readOnly]);

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
      if (!$isSkillTokenNode(adjacent)) return false;
      adjacent.remove();
      let nextSelection = $getSelection();
      if (!$isRangeSelection(nextSelection)) {
        $getRoot().selectEnd();
        nextSelection = $getSelection();
      }
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
      if (!readOnly || !onStopRef.current) return false;
      event?.preventDefault();
      onStopRef.current();
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  ), [editor, readOnly]);

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
  nodes: [SkillTokenNode],
  onError(error: Error): void {
    throw error;
  },
};

export const InlineSkillComposer = forwardRef<InlineSkillComposerHandle, InlineSkillComposerProps>(function InlineSkillComposer(
  { ariaLabel, className, disabled = false, onChange, onStop, onSubmit, placeholder, readOnly = false },
  ref,
) {
  const editorRef = useRef<LexicalEditor | null>(null);
  const selectionRef = useRef<RangeSelection | null>(null);
  const [hasContent, setHasContent] = useState(false);
  const hasContentRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useImperativeHandle(ref, () => ({
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
    insertSkill(skill) {
      const editor = editorRef.current;
      if (!editor || disabled || readOnly) return;
      editor.update(() => {
        const savedSelection = selectionRef.current;
        if (savedSelection && $getNodeByKey(savedSelection.anchor.key) && $getNodeByKey(savedSelection.focus.key)) {
          $setSelection(savedSelection.clone());
        } else {
          $getRoot().selectEnd();
        }
        const token = $createSkillTokenNode(skill.id, skill.name, skill.source);
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
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
                if (event.key === "Escape" && readOnly) {
                  event.preventDefault();
                  onStop?.();
                }
              }}
              placeholder={null}
            />
          )}
          placeholder={null}
        />
        {!hasContent ? <span aria-hidden className="pointer-events-none absolute left-0.5 top-0 text-[16px] font-normal leading-7 text-[#a2a29b] dark:text-muted-foreground">{placeholder}</span> : null}
      </div>
      <EditorRefPlugin editorRef={editorRef} />
      <HistoryPlugin />
      <EditorEditablePlugin editable={!disabled && !readOnly} />
      <EditorCommandsPlugin onStop={onStop} onSubmit={onSubmit} readOnly={readOnly} selectionRef={selectionRef} />
      <SelectionMemoryPlugin selectionRef={selectionRef} />
      <OnChangePlugin
        ignoreSelectionChange
        onChange={(nextEditorState) => {
          const value = editorValue(nextEditorState);
          const nextHasContent = value.text.length > 0 || value.skillIds.length > 0;
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
