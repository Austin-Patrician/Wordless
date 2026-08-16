import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { McpRegistryService } from "../src/main/marketplace/mcp-registry-service.ts";

const remoteServer = {
  server: {
    name: "example.com/search",
    title: "Example Search",
    description: "Search public sources.",
    version: "2.0.0",
    icons: [{ src: "https://mcp.example.com/icon.png", mimeType: "image/png", sizes: ["96x96"] }],
    remotes: [{ type: "streamable-http", url: "https://mcp.example.com/mcp" }],
  },
};

test("normalizes latest remote MCP entries and caches each query", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wordless-mcp-market-"));
  const requests: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    requests.push(new URL(String(input)));
    return new Response(JSON.stringify({ servers: [remoteServer], metadata: { nextCursor: "next" } }), {
      status: 200,
      headers: { "content-type": "application/json", etag: "one" },
    });
  };
  try {
    const service = new McpRegistryService(root, "https://registry.example/v0.1/servers", fetchImpl);
    const first = await service.search("search");
    const cached = await service.search("search");
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.searchParams.get("version"), "latest");
    assert.equal(requests[0]?.searchParams.get("search"), "search");
    assert.equal(first.entries[0]?.installable, true);
    assert.equal(first.entries[0]?.transport, "streamable-http");
    assert.equal(first.entries[0]?.iconUrl, "https://mcp.example.com/icon.png");
    assert.equal(cached.entries[0]?.title, "Example Search");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires custom setup for header-based remotes and local packages", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wordless-mcp-market-"));
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    servers: [
      { server: { ...remoteServer.server, name: "example.com/private", remotes: [{ type: "streamable-http", url: "https://private.example/mcp", headers: [{ name: "Authorization" }] }] } },
      { server: { name: "example.com/local", version: "1.0.0", repository: { url: "https://github.com/example/local-mcp" }, packages: [{ registryType: "npm", identifier: "local-mcp", version: "1.0.0", environmentVariables: [{ name: "LOCAL_API_KEY", description: "API key", isSecret: true }] }] } },
    ],
    metadata: {},
  }), { status: 200 });
  try {
    const page = await new McpRegistryService(root, "https://registry.example/v0.1/servers", fetchImpl).search();
    assert.equal(page.entries[0]?.auth, "API key / headers");
    assert.equal(page.entries[0]?.installable, false);
    assert.equal(page.entries[1]?.transport, "unsupported");
    assert.equal(page.entries[1]?.packageName, "local-mcp");
    assert.equal(page.entries[1]?.setup.suggestedCommand, "npx -y local-mcp");
    assert.equal(page.entries[1]?.setup.requiredInputs[0]?.name, "LOCAL_API_KEY");
    assert.equal(page.entries[1]?.setup.documentationLabel, "Source repository");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("accepts HTTPS SVG icons published by the official registry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wordless-mcp-market-"));
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    servers: [{ server: { ...remoteServer.server, icons: [{ src: "https://mcp.example.com/icon.svg", mimeType: "image/svg+xml", sizes: ["any"] }] } }],
    metadata: {},
  }), { status: 200 });
  try {
    const page = await new McpRegistryService(root, "https://registry.example/v0.1/servers", fetchImpl).search();
    assert.equal(page.entries[0]?.iconUrl, "https://mcp.example.com/icon.svg");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("revalidates an exact latest entry before installation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wordless-mcp-market-"));
  let requested = "";
  const fetchImpl: typeof fetch = async (input) => {
    requested = String(input);
    return new Response(JSON.stringify(remoteServer), { status: 200 });
  };
  try {
    const entry = await new McpRegistryService(root, "https://registry.example/v0.1/servers", fetchImpl).getDetail("example.com/search");
    assert.match(requested, /example\.com%2Fsearch\/versions\/latest$/);
    assert.equal(entry.url, "https://mcp.example.com/mcp");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
