import assert from "node:assert/strict";
import test from "node:test";
import { resolveMcpMarketplaceIcon } from "../src/renderer/shared/mcp-marketplace-icon-rules.ts";

test("maps marketplace titles and slugs onto local MCP brand icons", () => {
  assert.equal(
    resolveMcpMarketplaceIcon({
      name: "com.github/github",
      title: "GitHub",
    }).id,
    "github",
  );
  assert.equal(
    resolveMcpMarketplaceIcon({
      name: "com.figma/mcp",
      title: "Figma",
    }).id,
    "figma",
  );
  assert.equal(
    resolveMcpMarketplaceIcon({
      name: "com.firecrawl/mcp",
      title: "Firecrawl",
    }).id,
    "firecrawl",
  );
  assert.equal(
    resolveMcpMarketplaceIcon({
      name: "io.github.postgres/postgres-mcp",
      title: "Postgres",
    }).id,
    "postgresql",
  );
  assert.equal(
    resolveMcpMarketplaceIcon({
      name: "com.virxact/ai-hot",
      title: "AI hot",
    }).id,
    "ai-hot",
  );
  assert.equal(
    resolveMcpMarketplaceIcon({
      name: "com.example/web-search",
      title: "Web Search",
    }).id,
    "web-search",
  );
  assert.equal(
    resolveMcpMarketplaceIcon({
      name: "com.feishu/mcp",
      title: "飞书",
    }).id,
    "feishu",
  );
  assert.equal(
    resolveMcpMarketplaceIcon({
      name: "com.dingtalk/mcp",
      title: "钉钉",
    }).id,
    "dingtalk",
  );
  assert.equal(
    resolveMcpMarketplaceIcon({
      name: "com.wecom/mcp",
      title: "企业微信",
    }).id,
    "wecom",
  );
});

test("does not treat GitHub-hosted publishers as the GitHub MCP", () => {
  assert.equal(
    resolveMcpMarketplaceIcon({
      name: "io.github.acme/notion",
      title: "Notion",
    }).id,
    "integrated-information-management",
  );
  assert.notEqual(
    resolveMcpMarketplaceIcon({
      name: "io.github.acme/gitlab",
      title: "GitLab",
    }).id,
    "github",
  );
});

test("maps category descriptions onto local MCP icons instead of lucide", () => {
  assert.equal(
    resolveMcpMarketplaceIcon({
      name: "example.com/metrics",
      title: "Ops Board",
      description: "Analytics dashboard and KPI metrics.",
    }).id,
    "metric-board",
  );
  assert.equal(
    resolveMcpMarketplaceIcon({
      name: "example.com/tickets",
      title: "Tracker",
      description: "Jira issue tracker for work orders.",
    }).id,
    "work-order-management",
  );
  assert.equal(
    resolveMcpMarketplaceIcon({
      name: "example.com/generic",
      title: "Example",
      transport: "stdio",
    }).id,
    "tool-management",
  );
  assert.equal(
    resolveMcpMarketplaceIcon({
      name: "example.com/remote",
      title: "Example",
      transport: "streamable-http",
    }).id,
    "system-global-configuration",
  );
});
