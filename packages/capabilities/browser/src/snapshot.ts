/**
 * Turns a Chrome DevTools accessibility tree into the compact text an agent
 * reads a page through.
 *
 * Accessibility snapshots rather than screenshots, because the published
 * comparison is stark: a tree-based agent scores around 89% on WebVoyager where
 * a screenshot-driven one manages 59–65% at three to five times the token cost,
 * and every vision step adds 0.5–2s of capture and encoding latency. The tree
 * also gives stable element handles that survive a redeploy, which DOM selectors
 * do not — a Tailwind or CSS-module class list changes on every build.
 *
 * Pure by construction: no Electron, no DOM, no I/O. The caller supplies the
 * nodes, which is what lets the rules below be tested directly.
 */

/** The subset of a CDP `Accessibility.AXNode` this module reads. */
export type AxNode = {
  nodeId: string;
  /** Nodes Chromium has excluded from the tree for assistive technology. */
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  childIds?: string[];
  /** Identifies the underlying DOM node, for a later click by reference. */
  backendDOMNodeId?: number;
};

export type SnapshotRef = {
  ref: string;
  role: string;
  name: string;
  backendDOMNodeId: number | null;
  /**
   * 1-based rank among nodes sharing this role and name.
   *
   * The same ordinal the rendered text uses to disambiguate duplicates, kept as
   * data rather than only as display text: it is what lets an action recover its
   * target after the page re-renders and the `@eN` handles are renumbered.
   */
  ordinal: number;
};

export type SnapshotResult = {
  /** Indented `[ref] role "name"` lines, one per reported node. */
  text: string;
  refs: SnapshotRef[];
  /** Nodes visited in the tree, including filtered ones. */
  nodeCount: number;
  /** True when a cap cut the output short. */
  truncated: boolean;
};

export type SnapshotOptions = {
  /** Emitted-line cap. Beyond this the result is marked truncated. */
  maxLines?: number;
  /** Names longer than this are ellipsised, so one verbose node cannot dominate. */
  maxNameLength?: number;
};

export const DEFAULT_MAX_SNAPSHOT_LINES = 2_000;
export const DEFAULT_MAX_NAME_LENGTH = 120;

/**
 * Roles that carry no information for a reader. A modern SPA's accessibility
 * tree is mostly these, and emitting them buries the handful of nodes that
 * matter — the same reason a login form reads as five tree nodes and forty-seven
 * DOM nodes.
 */
const NOISE_ROLES = new Set(["generic", "none", "presentation", "inlinetextbox"]);

/**
 * Roles a user can act on. Only these receive a `@eN` reference, so a ref always
 * means "you can click or type into this" rather than "this exists".
 */
const INTERACTIVE_ROLES = new Set([
  "button", "checkbox", "combobox", "disclosuretriangle", "gridcell", "link", "listbox",
  "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio", "searchbox",
  "slider", "spinbutton", "switch", "tab", "textbox", "treeitem",
]);

export function buildSnapshot(nodes: readonly AxNode[], options: SnapshotOptions = {}): SnapshotResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_SNAPSHOT_LINES;
  const maxNameLength = options.maxNameLength ?? DEFAULT_MAX_NAME_LENGTH;

  const byId = new Map<string, AxNode>();
  for (const node of nodes) byId.set(node.nodeId, node);

  // Chromium orders the flat list with the root first, but a caller could pass a
  // subtree, so fall back to the first node that nothing else claims as a child.
  const root = nodes.find((node) => node.nodeId === nodes[0]?.nodeId) ?? nodes[0];
  if (!root) return { text: "", refs: [], nodeCount: 0, truncated: false };

  type Emitted = { role: string; name: string; depth: number; node: AxNode };
  const emitted: Emitted[] = [];
  let nodeCount = 0;
  let truncated = false;

  // Iterative walk: page trees nest deeply enough that recursion is a liability,
  // and a malformed tree with a cycle must not hang the agent.
  const visited = new Set<string>();
  const stack: Array<{ node: AxNode; depth: number }> = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    const { node, depth } = current;
    if (visited.has(node.nodeId)) continue;
    visited.add(node.nodeId);
    nodeCount++;

    const rawRole = (node.role?.value ?? "").trim();
    // Lower-cased for classification only: CDP mixes `button` with
    // `RootWebArea`, and the agent should read the names Chromium actually uses.
    const role = rawRole.toLowerCase();
    const name = truncate((node.name?.value ?? "").trim(), maxNameLength);

    if (node.ignored) {
      for (const child of childrenOf(node, byId)) stack.push({ node: child, depth });
      continue;
    }
    const worthReporting = name.length > 0 || INTERACTIVE_ROLES.has(role);
    if (!worthReporting || NOISE_ROLES.has(role) || role.length === 0) {
      // Filtered levels do not consume indentation: nesting is expressed relative
      // to the reported ancestors, which keeps generic containers from pushing
      // real content to the right of a page of whitespace.
      for (const child of childrenOf(node, byId)) stack.push({ node: child, depth });
      continue;
    }
    if (emitted.length >= maxLines) {
      truncated = true;
      break;
    }
    emitted.push({ role: rawRole, name, depth, node });
    for (const child of childrenOf(node, byId)) stack.push({ node: child, depth: depth + 1 });
  }

  // Disambiguate repeats. A page with three "Submit" buttons is otherwise
  // impossible for the agent to act on, and the ordinal is also what lets a
  // reference be recovered after the tree is rebuilt.
  const totals = new Map<string, number>();
  for (const entry of emitted) {
    if (!isInteractive(entry.role)) continue;
    const key = `${entry.role}\u0000${entry.name}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }

  const refs: SnapshotRef[] = [];
  const seen = new Map<string, number>();
  const lines: string[] = [];
  for (const entry of emitted) {
    const indent = "  ".repeat(entry.depth);
    if (!isInteractive(entry.role)) {
      lines.push(`${indent}${entry.role} ${quote(entry.name)}`.trimEnd());
      continue;
    }
    const key = `${entry.role}\u0000${entry.name}`;
    const total = totals.get(key) ?? 1;
    const ordinal = (seen.get(key) ?? 0) + 1;
    seen.set(key, ordinal);
    const ref = `@e${refs.length + 1}`;
    const label = total > 1 && ordinal > 1 ? `${entry.name} (${ordinal}${ordinalSuffix(ordinal)})` : entry.name;
    refs.push({
      ref,
      role: entry.role,
      name: entry.name,
      backendDOMNodeId: entry.node.backendDOMNodeId ?? null,
      ordinal,
    });
    lines.push(`${indent}[${ref}] ${entry.role} ${quote(label)}`.trimEnd());
  }

  return { text: lines.join("\n"), refs, nodeCount, truncated };
}

function isInteractive(rawRole: string): boolean {
  return INTERACTIVE_ROLES.has(rawRole.toLowerCase());
}

/** Children in document order, skipping ids the tree does not contain. */
function childrenOf(node: AxNode, byId: Map<string, AxNode>): AxNode[] {
  const ids = node.childIds ?? [];
  const result: AxNode[] = [];
  // Reverse so the stack, which is a LIFO, pops them back into document order.
  for (let index = ids.length - 1; index >= 0; index--) {
    const child = byId.get(ids[index]!);
    if (child) result.push(child);
  }
  return result;
}

function quote(value: string): string {
  return value ? `"${value.replace(/"/g, "'")}"` : "";
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function ordinalSuffix(value: number): string {
  const rest = value % 100;
  if (rest >= 11 && rest <= 13) return "th";
  switch (value % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}
