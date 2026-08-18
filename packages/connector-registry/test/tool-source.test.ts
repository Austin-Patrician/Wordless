import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectorRegistry } from "../src/index.ts";

let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (temporaryDirectory)
    await rm(temporaryDirectory, { force: true, recursive: true });
  temporaryDirectory = undefined;
});

describe("connector tool source", () => {
  it("attaches immutable connector identity to every registered tool", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "wordless-connector-source-"));
    const configPath = join(temporaryDirectory, "connectors.json");
    await writeFile(configPath, JSON.stringify({
      connectors: [{
        configuration: {
          id: "connector-1",
          name: "Web Search",
          templateId: "web-search",
          transport: "streamable-http",
          enabled: true,
          trustedAt: null,
          command: null,
          args: [],
          cwd: null,
          environment: {},
          url: "https://mcp.example/service",
          headers: [],
          oauth: null,
          createdAt: 1,
          updatedAt: 1,
        },
        status: "ready",
        tools: [{
          name: "search",
          title: "Search",
          description: "Search the web",
          readOnly: true,
          destructive: false,
        }],
        resources: [],
        prompts: [],
      }],
    }), "utf8");
    const registry = new ConnectorRegistry({ configPath });
    await registry.initialize();

    expect(registry.createTools(["connector-1"])[0]?.source).toEqual({
      kind: "mcp",
      connectorId: "connector-1",
      connectorName: "Web Search",
      toolName: "search",
      templateId: "web-search",
      transport: "streamable-http",
    });
  });
});
