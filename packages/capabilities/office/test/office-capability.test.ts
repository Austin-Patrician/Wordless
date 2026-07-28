import { describe, expect, it } from "vitest";
import { compileOfficeMutations } from "../src/index.ts";

describe("compileOfficeMutations", () => {
  it("normalizes actual and single-escaped line endings before JSON serialization", () => {
    expect(compileOfficeMutations([{ command: "set", path: "/slide[1]/shape[1]", props: { text: "A\r\nB\\nC" } }])).toEqual([
      { command: "set", path: "/slide[1]/shape[1]", props: { text: "A\nB\nC" } },
    ]);
  });

  it("requires complete discriminated mutation inputs", () => {
    expect(() => compileOfficeMutations([{ command: "add", parent: "/" }])).toThrow("requires type or from");
    expect(() => compileOfficeMutations([{ command: "move", path: "/slide[1]" }])).toThrow("requires to, after, or before");
  });
});
