import type { InlineMath, Math } from "mdast-util-math";
import type { CompileContext, Extension as FromMarkdownExtension } from "mdast-util-from-markdown";
import { markdownLineEnding } from "micromark-util-character";
import type { Construct, Effects, Extension as MicromarkExtension, State, Token } from "micromark-util-types";
import type { Paragraph, PhrasingContent, Root, RootContent, Text } from "mdast";
import type { Plugin, Transformer } from "unified";
import type {} from "remark-parse";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    wordlessMathData: "wordlessMathData";
    wordlessMathDisplay: "wordlessMathDisplay";
    wordlessMathInline: "wordlessMathInline";
    wordlessMathMarker: "wordlessMathMarker";
  }
}

declare module "mdast-util-math" {
  interface InlineMathData {
    wordlessDisplayMath?: boolean;
  }
}

type TraversableNode = {
  children?: TraversableNode[];
  type: string;
};

const INLINE_OPEN = 40;
const INLINE_CLOSE = 41;
const DISPLAY_OPEN = 91;
const DISPLAY_CLOSE = 93;
const BACKSLASH = 92;

function createDelimitedMathConstruct(openCode: number, closeCode: number, display: boolean): Construct {
  return {
    name: display ? "wordlessMathDisplay" : "wordlessMathInline",
    tokenize(effects, ok, nok) {
      let marker: Token;
      const tokenType = display ? "wordlessMathDisplay" : "wordlessMathInline";

      return start;

      function start(code: number | null): State | undefined {
        effects.enter(tokenType);
        effects.enter("wordlessMathMarker");
        if (code !== BACKSLASH) return nok(code);
        effects.consume(code);
        return open;
      }

      function open(code: number | null): State | undefined {
        if (code !== openCode) return nok(code);
        effects.consume(code);
        effects.exit("wordlessMathMarker");
        return between;
      }

      function between(code: number | null): State | undefined {
        if (code === null) return nok(code);
        if (!display && markdownLineEnding(code)) return nok(code);
        if (code === BACKSLASH) {
          marker = effects.enter("wordlessMathMarker");
          effects.consume(code);
          return close;
        }
        if (markdownLineEnding(code)) {
          effects.enter("lineEnding");
          effects.consume(code);
          effects.exit("lineEnding");
          return between;
        }
        effects.enter("wordlessMathData");
        return data(code);
      }

      function data(code: number | null): State | undefined {
        if (code === null || code === BACKSLASH || markdownLineEnding(code)) {
          effects.exit("wordlessMathData");
          return between(code);
        }
        effects.consume(code);
        return data;
      }

      function close(code: number | null): State | undefined {
        if (code === closeCode) {
          effects.consume(code);
          effects.exit("wordlessMathMarker");
          effects.exit(tokenType);
          return ok;
        }
        marker.type = "wordlessMathData";
        if (code === BACKSLASH) {
          effects.consume(code);
          return data;
        }
        return data(code);
      }
    },
  };
}

const incompleteDelimiter: Construct = {
  name: "wordlessMathIncompleteDelimiter",
  tokenize(effects: Effects, ok: State, nok: State): State {
    return start;

    function start(code: number | null): State | undefined {
      if (code !== BACKSLASH) return nok(code);
      effects.enter("data");
      effects.consume(code);
      return open;
    }

    function open(code: number | null): State | undefined {
      if (code !== INLINE_OPEN && code !== DISPLAY_OPEN) return nok(code);
      effects.consume(code);
      effects.exit("data");
      return ok;
    }
  },
};

const texMathSyntax: MicromarkExtension = {
  text: {
    [BACKSLASH]: [
      createDelimitedMathConstruct(INLINE_OPEN, INLINE_CLOSE, false),
      createDelimitedMathConstruct(DISPLAY_OPEN, DISPLAY_CLOSE, true),
      incompleteDelimiter,
    ],
  },
};

function enterMath(this: CompileContext, token: Token, display: boolean): void {
  const node: InlineMath = {
    type: "inlineMath",
    value: "",
    data: {
      hName: "code",
      hProperties: { className: ["language-math", display ? "math-display" : "math-inline"] },
      hChildren: [],
      ...(display ? { wordlessDisplayMath: true } : {}),
    },
  };
  this.enter(node, token);
  this.buffer();
}

function exitMath(this: CompileContext, token: Token): void {
  const value = this.resume();
  const node = this.stack.at(-1);
  if (!node || node.type !== "inlineMath") throw new Error("Wordless math parser exited without an inline math node");
  this.exit(token);
  node.value = value;
  node.data = { ...node.data, hChildren: [{ type: "text", value }] };
}

function exitMathData(this: CompileContext, token: Token): void {
  this.config.enter.data.call(this, token);
  this.config.exit.data.call(this, token);
}

const texMathFromMarkdown: FromMarkdownExtension = {
  enter: {
    wordlessMathDisplay(token) { enterMath.call(this, token, true); },
    wordlessMathInline(token) { enterMath.call(this, token, false); },
  },
  exit: {
    wordlessMathData: exitMathData,
    wordlessMathDisplay: exitMath,
    wordlessMathInline: exitMath,
  },
};

function sourceSlice(node: InlineMath, source: string): string | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? null : source.slice(start, end);
}

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && value.trim() === "";
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}

function isDisplayMath(node: InlineMath, source: string): boolean {
  if (node.data?.wordlessDisplayMath) return true;
  const raw = sourceSlice(node, source);
  return raw?.startsWith("$$") === true;
}

function isValidSingleDollarMath(node: InlineMath, source: string): boolean {
  const raw = sourceSlice(node, source);
  if (!raw?.startsWith("$") || raw.startsWith("$$")) return true;
  const end = node.position?.end.offset;
  if (raw.length < 3 || !raw.endsWith("$")) return false;
  if (isWhitespace(raw[1]) || isWhitespace(raw.at(-2))) return false;
  return end === undefined || !isDigit(source[end]);
}

function mathBlock(node: InlineMath): Math {
  const code = {
    type: "element" as const,
    tagName: "code",
    properties: { className: ["language-math", "math-display"] },
    children: [{ type: "text" as const, value: node.value }],
  };
  return {
    type: "math",
    meta: null,
    value: node.value,
    data: { hName: "pre", hChildren: [code] },
    position: node.position,
  };
}

function normalizeParagraph(paragraph: Paragraph, source: string): RootContent[] {
  const normalized = paragraph.children;
  if (!normalized.some((child) => child.type === "inlineMath" && isDisplayMath(child, source))) {
    return [{ ...paragraph, children: normalized }];
  }

  const result: RootContent[] = [];
  let pending: PhrasingContent[] = [];
  const flushParagraph = () => {
    if (pending.length === 0) return;
    result.push({ type: "paragraph", children: pending });
    pending = [];
  };
  for (const child of normalized) {
    if (child.type === "inlineMath" && isDisplayMath(child, source)) {
      flushParagraph();
      result.push(mathBlock(child));
    } else {
      pending.push(child);
    }
  }
  flushParagraph();
  return result;
}

function normalizeMathTree(tree: Root, source: string): Root {
  const root = tree as TraversableNode;
  const visit = (parent: TraversableNode): void => {
    if (!parent.children) return;
    for (let index = 0; index < parent.children.length; index++) {
      const child = parent.children[index]!;
      if (child.type === "inlineMath") {
        const inlineMath = child as InlineMath;
        if (!isValidSingleDollarMath(inlineMath, source)) {
          const value = sourceSlice(inlineMath, source) ?? `$${inlineMath.value}$`;
          const text: Text = { type: "text", value, position: inlineMath.position };
          parent.children[index] = text as TraversableNode;
        }
        continue;
      }
      if (child.type === "paragraph") {
        visit(child);
        const replacement = normalizeParagraph(child as Paragraph, source) as TraversableNode[];
        parent.children.splice(index, 1, ...replacement);
        index += replacement.length - 1;
        continue;
      }
      visit(child);
    }
  };
  visit(root);
  return tree;
}

const transformMathTree: Transformer<Root> = (tree, file) => normalizeMathTree(tree, String(file.value));

/** Adds TeX delimiters and Wordless math boundary rules to remark-math. */
export const remarkWordlessMath: Plugin<[], Root> = function remarkWordlessMath() {
  const data = this.data();
  const micromarkExtensions = data.micromarkExtensions || (data.micromarkExtensions = []);
  const fromMarkdownExtensions = data.fromMarkdownExtensions || (data.fromMarkdownExtensions = []);
  micromarkExtensions.push(texMathSyntax);
  fromMarkdownExtensions.push(texMathFromMarkdown);
  return transformMathTree;
};
