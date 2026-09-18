// Selection capture for message content.
//
// The menu only ever offers actions that read the selection once, at open time:
// the DOM selection is not reliable afterwards because the thread list is
// virtualized (react-virtuoso recycles rows) and assistant markdown re-renders
// while streaming. So every action works from this immutable snapshot.
//
// Serialization walks the live DOM under a scope element and clips text at the
// range boundaries instead of cloning the range: `Range.cloneContents()` drops
// the block wrapper whenever a selection covers exactly one block (triple-click,
// "select paragraph"), which would silently turn `# Heading` into `Heading`.

export type SelectionMode = "markdown" | "text";

/** Viewport-space box of a selection, used to anchor the translation bubble. */
export type SelectionRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type MessageSelectionSnapshot = {
  /** Plain text with block boundaries preserved as blank lines. */
  text: string;
  /** Markdown reconstruction of the same region, best-effort over known message DOM. */
  markdown: string;
  /** Union of the selection's client rects, in viewport coordinates. */
  rect: SelectionRect;
  /** Rendered line count; long multi-line selections go to the panel, not a bubble. */
  lineCount: number;
  /**
   * True when the whole selection sits inside one code block. Code is copied as
   * source and is never offered for translation.
   */
  insideCodeBlock: boolean;
};

/** UI affordances inside rendered markdown that must never leak into copied text. */
const SKIPPED_TAGS = new Set(["BUTTON", "SVG", "HEADER", "IFRAME", "VIDEO", "AUDIO", "STYLE", "SCRIPT", "TEXTAREA", "SELECT"]);
const BLOCK_TAGS = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "DL", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "UL"]);
const LIST_TAGS = new Set(["UL", "OL"]);

function directChildren(node: Node): Node[] {
  return Array.from(node.childNodes);
}

function isSkipped(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  if (SKIPPED_TAGS.has(node.tagName)) return true;
  return node.getAttribute("aria-hidden") === "true";
}

function isBlock(node: Node): boolean {
  return node instanceof Element && BLOCK_TAGS.has(node.tagName);
}

function collapseWhitespace(value: string): string {
  return value.replace(/[ \t\r\n]+/g, " ");
}

/** Text of one node, clipped to the range.
 *
 * Inclusion is decided with `intersectsNode` rather than by boundary identity:
 * a text node that merely sits near the selection still belongs to an
 * intersecting ancestor (the trailing `;` of a partially selected code block),
 * so identity-only clipping would copy text the user never selected.
 */
function textWithin(node: Text, range: Range): string {
  const value = node.nodeValue ?? "";
  if (!value || !range.intersectsNode(node)) return "";
  const start = node === range.startContainer ? Math.min(range.startOffset, value.length) : 0;
  const end = node === range.endContainer ? Math.min(range.endOffset, value.length) : value.length;
  return start >= end ? "" : value.slice(start, end);
}

/** Concatenated text of a subtree, clipped to the range and skipping affordances. */
function subtreeText(node: Node, range: Range): string {
  let output = "";
  const walk = (current: Node) => {
    if (current.nodeType === 3) {
      output += textWithin(current as Text, range);
      return;
    }
    if (!range.intersectsNode(current) || isSkipped(current)) return;
    for (const child of directChildren(current)) walk(child);
  };
  walk(node);
  return output;
}

function inlineText(node: Node, mode: SelectionMode, range: Range): string {
  if (node.nodeType === 3) return collapseWhitespace(textWithin(node as Text, range));
  if (!(node instanceof Element) || isSkipped(node)) return "";
  if (!range.intersectsNode(node)) return "";
  const children = directChildren(node).map((child) => inlineText(child, mode, range)).join("");
  const emphasize = (marker: string) => (mode === "markdown" && children.trim() ? `${marker}${children.trim()}${marker}` : children);
  switch (node.tagName) {
    case "STRONG":
    case "B":
      return emphasize("**");
    case "EM":
    case "I":
      return emphasize("*");
    case "DEL":
    case "S":
      return emphasize("~~");
    case "CODE":
      return emphasize("`");
    case "BR":
      return mode === "markdown" ? "  \n" : "\n";
    case "IMG": {
      const alt = node.getAttribute("alt") ?? "";
      const source = node.getAttribute("src") ?? "";
      return mode === "markdown" && source ? `![${alt}](${source})` : alt;
    }
    case "INPUT": {
      if (node.getAttribute("type") !== "checkbox") return children;
      const input = node as HTMLInputElement;
      return input.checked || node.hasAttribute("checked") ? "[x] " : "[ ] ";
    }
    case "A": {
      if (mode !== "markdown") return children;
      const href = node.getAttribute("href") ?? "";
      const label = children.trim();
      return href && label ? `[${label}](${href})` : children;
    }
    default:
      return children;
  }
}

/** One list, rendered as a single block so nesting never gains blank lines. */
function serializeList(node: Element, depth: number, mode: SelectionMode, range: Range): string {
  const indent = "  ".repeat(depth);
  const ordered = node.tagName === "OL";
  const lines: string[] = [];
  let index = 1;
  for (const child of directChildren(node)) {
    if (!(child instanceof Element) || child.tagName !== "LI") continue;
    const nested: Element[] = [];
    const content: Node[] = [];
    for (const item of directChildren(child)) {
      if (item instanceof Element && LIST_TAGS.has(item.tagName)) nested.push(item);
      else content.push(item);
    }
    const body = content.map((item) => inlineText(item, mode, range)).join("").trim();
    if (body) lines.push(`${indent}${mode === "markdown" ? (ordered ? `${index}. ` : "- ") : ""}${body}`);
    for (const sublist of nested) lines.push(...serializeList(sublist, depth + 1, mode, range).split("\n"));
    index += 1;
  }
  return lines.join("\n");
}

function serializeTable(node: Element, mode: SelectionMode, range: Range): string {
  const rows = Array.from(node.querySelectorAll("tr"))
    .filter((row) => range.intersectsNode(row))
    .map((row) =>
      Array.from(row.querySelectorAll("th, td"))
        .filter((cell) => range.intersectsNode(cell))
        .map((cell) => collapseWhitespace(subtreeText(cell, range)).trim()),
    )
    .filter((cells) => cells.some((cell) => cell.length > 0));
  if (rows.length === 0) return "";
  if (mode === "text") return rows.map((cells) => cells.join(" | ")).join("\n");
  const width = Math.max(...rows.map((cells) => cells.length));
  const normalized = rows.map((cells) => [...cells, ...Array.from({ length: width - cells.length }, () => "")]);
  return [
    `| ${normalized[0].join(" | ")} |`,
    `| ${normalized[0].map(() => "---").join(" | ")} |`,
    ...normalized.slice(1).map((cells) => `| ${cells.join(" | ")} |`),
  ].join("\n");
}

function serializeCodeBlock(node: Element, mode: SelectionMode, range: Range): string {
  const source = (node.querySelector("code")?.textContent ?? node.textContent ?? "").replace(/\n+$/, "");
  const selected = subtreeText(node, range).replace(/\n+$/, "");
  if (!selected) return "";
  // Re-fencing a partially selected block would invent code the user did not
  // select, so only a fully covered block keeps its fence and language.
  if (mode === "text" || selected.length < source.length) return selected;
  const language = node.querySelector("code")?.getAttribute("data-wordless-language")?.trim() ?? "";
  return `\`\`\`${language}\n${source}\n\`\`\``;
}

function serializeBlockquote(node: Element, mode: SelectionMode, range: Range): string {
  const inner = serializeBlocks(directChildren(node), 0, mode, range).join("\n\n");
  if (!inner.trim()) return "";
  if (mode === "text") return inner;
  return inner.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
}

function serializeHeading(node: Element, mode: SelectionMode, range: Range): string {
  const body = inlineText(node, mode, range).trim();
  if (!body) return "";
  return mode === "markdown" ? `${"#".repeat(Number(node.tagName.slice(1)))} ${body}` : body;
}

/** Serializes a node list into blocks. Each block may contain newlines. */
export function serializeBlocks(nodes: Node[], depth: number, mode: SelectionMode, range: Range): string[] {
  const blocks: string[] = [];
  const push = (value: string) => {
    if (value.trim()) blocks.push(value.trim());
  };
  let pending = "";
  const flush = () => {
    const value = pending;
    pending = "";
    push(value);
  };
  for (const node of nodes) {
    if (isSkipped(node) || !range.intersectsNode(node)) continue;
    if (node.nodeType === 3) {
      pending += collapseWhitespace(textWithin(node as Text, range));
      continue;
    }
    if (!(node instanceof Element)) continue;
    if (LIST_TAGS.has(node.tagName)) {
      flush();
      push(serializeList(node, depth, mode, range));
      continue;
    }
    if (node.tagName === "TABLE") {
      flush();
      push(serializeTable(node, mode, range));
      continue;
    }
    if (node.tagName === "PRE") {
      flush();
      push(serializeCodeBlock(node, mode, range));
      continue;
    }
    if (node.tagName === "BLOCKQUOTE") {
      flush();
      push(serializeBlockquote(node, mode, range));
      continue;
    }
    if (node.tagName === "HR") {
      flush();
      if (mode === "markdown") push("---");
      continue;
    }
    if (/^H[1-6]$/.test(node.tagName)) {
      flush();
      push(serializeHeading(node, mode, range));
      continue;
    }
    if (isBlock(node)) {
      flush();
      for (const block of serializeBlocks(directChildren(node), depth, mode, range)) push(block);
      continue;
    }
    pending += inlineText(node, mode, range);
  }
  flush();
  return blocks;
}

/** Serializes a range limited to `scope` as markdown or plain text. */
export function serializeRange(range: Range, mode: SelectionMode, scope: Node): string {
  return serializeBlocks(directChildren(scope), 0, mode, range).join("\n\n").trim();
}

/**
 * Captures the current DOM selection when it lives inside `root`.
 *
 * Returns null for collapsed selections, for selections that escaped `root`
 * (a cross-message drag resolves to an ancestor outside the message, which is
 * how the single-message rule is enforced), and for selections that contain no
 * text once UI affordances are excluded.
 */
export function captureMessageSelection(root: HTMLElement | null): MessageSelectionSnapshot | null {
  if (!root) return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  return messageSelectionFromRange(selection.getRangeAt(0), root);
}

/**
 * Builds a snapshot from a specific range.
 *
 * Separate from the live-selection reader because Chromium clears the selection
 * when the right button is pressed away from it, so the menu sometimes has to
 * describe a selection that no longer exists in the document.
 */
export function messageSelectionFromRange(range: Range, root: HTMLElement | null): MessageSelectionSnapshot | null {
  if (!root) return null;
  const ancestor = range.commonAncestorContainer;
  const ancestorElement = ancestor instanceof Element ? ancestor : ancestor.parentElement;
  if (!ancestorElement || (ancestorElement !== root && !root.contains(ancestorElement))) return null;
  const geometry = {
    rect: selectionRectOf(range),
    lineCount: range.getClientRects().length,
    // Code is copied as source and is never offered for translation.
    insideCodeBlock: ancestorElement.closest("pre") !== null,
  };
  const markdown = serializeRange(range, "markdown", root);
  const text = serializeRange(range, "text", root);
  if (!markdown && !text) return null;
  return { text, markdown, ...geometry };
}

/** Block-level ancestor that owns a range, used to scope remembered selections. */
const RANGE_BLOCK_SELECTOR = "p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6, pre, figcaption, dd, dt, caption";

/**
 * Nearest block element containing the range.
 *
 * Used to decide whether a right-click still refers to a remembered selection:
 * a right-click inside the same paragraph as the selected word means the user is
 * acting on that word, while a right-click in another paragraph does not.
 */
export function rangeBlockElement(range: Range): Element | null {
  const ancestor = range.commonAncestorContainer;
  const element = ancestor instanceof Element ? ancestor : ancestor.parentElement;
  return element?.closest(RANGE_BLOCK_SELECTOR) ?? null;
}

/**
 * Union of the range's client rects in viewport coordinates.
 *
 * `getBoundingClientRect()` is not used directly because a range spanning
 * several elements can report a box far larger than the selected lines.
 */
function selectionRectOf(range: Range): SelectionRect {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
  if (rects.length === 0) {
    const fallback = range.getBoundingClientRect();
    return { top: fallback.top, left: fallback.left, width: fallback.width, height: fallback.height };
  }
  const top = Math.min(...rects.map((rect) => rect.top));
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { top, left, width: right - left, height: bottom - top };
}
