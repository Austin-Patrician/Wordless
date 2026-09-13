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
          inputSchema: {
            type: "object",
            properties: { url: { type: "string" } },
            required: ["url"],
          },
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

  it("exposes the MCP server input schema so required arguments reach the model", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "wordless-connector-schema-"));
    const configPath = join(temporaryDirectory, "connectors.json");
    const inputSchema = {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    };
    await writeFile(configPath, JSON.stringify({
      connectors: [{
        configuration: {
          id: "connector-1",
          name: "Firecrawl",
          templateId: "firecrawl",
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
          name: "firecrawl_map",
          title: "Map",
          description: "Map a site",
          inputSchema,
          readOnly: true,
          destructive: false,
        }],
        resources: [],
        prompts: [],
      }],
    }), "utf8");
    const registry = new ConnectorRegistry({ configPath });
    await registry.initialize();

    expect(registry.createTools(["connector-1"])[0]?.parameters).toEqual(inputSchema);
  });

  it("falls back to a permissive schema when the MCP server declares none", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "wordless-connector-no-schema-"));
    const configPath = join(temporaryDirectory, "connectors.json");
    await writeFile(configPath, JSON.stringify({
      connectors: [{
        configuration: {
          id: "connector-1",
          name: "Legacy",
          templateId: null,
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
          name: "ping",
          title: "Ping",
          description: "",
          readOnly: null,
          destructive: null,
        }],
        resources: [],
        prompts: [],
      }],
    }), "utf8");
    const registry = new ConnectorRegistry({ configPath });
    await registry.initialize();

    expect(registry.createTools(["connector-1"])[0]?.parameters).toEqual({
      type: "object",
      additionalProperties: true,
    });
  });
});
