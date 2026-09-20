import { expect, it } from "vitest";
import { buildSnapshot, type AxNode } from "../src/snapshot.ts";

function node(id: string, role: string, name: string, childIds: string[] = [], extra: Partial<AxNode> = {}): AxNode {
  return { nodeId: id, role: { value: role }, name: { value: name }, childIds, ...extra };
}

/** A login form, the worked example the token comparison uses. */
const LOGIN_FORM: AxNode[] = [
  node("1", "RootWebArea", "Sign in", ["2", "3", "4", "5"]),
  node("2", "heading", "Welcome back"),
  node("3", "textbox", "Email"),
  node("4", "textbox", "Password"),
  node("5", "button", "Sign in"),
];

it("renders the interactive nodes an agent needs to act on a form", () => {
  const result = buildSnapshot(LOGIN_FORM);
  expect(result.text).toBe([
      'RootWebArea "Sign in"',
      '  heading "Welcome back"',
      '  [@e1] textbox "Email"',
      '  [@e2] textbox "Password"',
      '  [@e3] button "Sign in"',
    ].join("\n"));
  expect(result.refs.map((entry) => entry.ref)).toEqual(["@e1", "@e2", "@e3"]);
});

it("only interactive roles get a reference", () => {
  // A ref has to mean "you can act on this", otherwise the agent wastes calls on
  // nodes that do nothing when clicked.
  const result = buildSnapshot(LOGIN_FORM);
  expect(result.refs.every((entry) => entry.ref.startsWith("@e"))).toBe(true);
  expect(result.refs.some((entry) => entry.role === "heading")).toBe(false);
});

it("drops structural noise but keeps descending into it", () => {
  // A real accessibility tree is mostly generic containers; emitting them buries
  // the handful of nodes that matter.
  const result = buildSnapshot([
    node("1", "RootWebArea", "", ["2"]),
    node("2", "generic", "", ["3"]),
    node("3", "generic", "", ["4"]),
    node("4", "button", "Save"),
  ]);
  expect(result.text).toBe('[@e1] button "Save"');
  expect(result.nodeCount, "noise is filtered, not skipped").toBe(4);
});

it("filtered levels do not push real content to the right", () => {
  // Nesting is relative to the reported ancestors, so a page of wrapper divs does
  // not indent its actual content into a column of whitespace.
  const result = buildSnapshot([
    node("1", "RootWebArea", "", ["2"]),
    node("2", "generic", "", ["3"]),
    node("3", "generic", "", ["4"]),
    node("4", "button", "Deep"),
  ]);
  expect(result.text).toBe('[@e1] button "Deep"');
});

it("keeps nesting when the ancestors are reported", () => {
  const result = buildSnapshot([
    node("1", "RootWebArea", "App", ["2"]),
    node("2", "navigation", "Main", ["3"]),
    node("3", "link", "Home"),
  ]);
  expect(result.text).toBe(['RootWebArea "App"', '  navigation "Main"', '    [@e1] link "Home"'].join("\n"));
});

it("skips ignored nodes but still visits their children", () => {
  const result = buildSnapshot([
    node("1", "RootWebArea", "", ["2"]),
    { nodeId: "2", ignored: true, childIds: ["3"] },
    node("3", "button", "Visible"),
  ]);
  expect(result.text).toBe('[@e1] button "Visible"');
});

it("disambiguates repeated role and name pairs", () => {
  // Three "Submit" buttons are otherwise impossible for the agent to tell apart,
  // and the ordinal is what makes a reference recoverable after a re-render.
  const result = buildSnapshot([
    node("1", "RootWebArea", "", ["2", "3", "4"]),
    node("2", "button", "Submit"),
    node("3", "button", "Submit"),
    node("4", "button", "Submit"),
  ]);
  expect(result.text).toMatch(/\[@e1\] button "Submit"/);
  expect(result.text).toMatch(/\[@e2\] button "Submit \(2nd\)"/);
  expect(result.text).toMatch(/\[@e3\] button "Submit \(3rd\)"/);
});

it("leaves a unique name untouched", () => {
  const result = buildSnapshot([node("1", "RootWebArea", "", ["2"]), node("2", "button", "Submit")]);
  expect(result.text).toMatch(/"Submit"/);
  expect(result.text).not.toMatch(/\(2nd\)/);
});

it("marks the result truncated once the line cap is hit", () => {
  const many = Array.from({ length: 50 }, (_, index) => node(`n${index}`, "button", `B${index}`));
  const result = buildSnapshot([node("1", "RootWebArea", "", many.map((entry) => entry.nodeId)), ...many], { maxLines: 10 });
  expect(result.truncated).toBe(true);
  expect(result.refs.length).toBe(10);
});

it("does not mark a complete tree truncated", () => {
  expect(buildSnapshot(LOGIN_FORM, { maxLines: 10 }).truncated).toBe(false);
});

it("ellipsises an over-long name so one node cannot dominate the budget", () => {
  const result = buildSnapshot([node("1", "RootWebArea", "", ["2"]), node("2", "button", "x".repeat(300))], { maxNameLength: 20 });
  expect(result.text.includes("x".repeat(21))).toBe(false);
  expect(result.text).toMatch(/…/);
});

it("escapes quotes so a name cannot break the line format", () => {
  const result = buildSnapshot([node("1", "RootWebArea", "", ["2"]), node("2", "button", 'Say "hi"')]);
  expect(result.text).toMatch(/"Say 'hi'"/);
});

it("returns nothing for an empty tree", () => {
  expect(buildSnapshot([])).toEqual({ text: "", refs: [], nodeCount: 0, truncated: false });
});

it("survives a dangling child id", () => {
  const result = buildSnapshot([node("1", "RootWebArea", "", ["missing", "2"]), node("2", "button", "Ok")]);
  expect(result.text).toMatch(/\[@e1\] button "Ok"/);
});

it("survives a cyclic child reference instead of hanging", () => {
  // A malformed tree must not lock up the agent loop.
  const result = buildSnapshot([node("1", "RootWebArea", "", ["2"]), node("2", "generic", "", ["1", "3"]), node("3", "button", "Ok")]);
  expect(result.text).toMatch(/\[@e1\] button "Ok"/);
});

it("carries the backend node id so a reference can be acted on later", () => {
  const result = buildSnapshot([node("1", "RootWebArea", "", ["2"]), node("2", "button", "Ok", [], { backendDOMNodeId: 42 })]);
  expect(result.refs[0]?.backendDOMNodeId).toBe(42);
});
