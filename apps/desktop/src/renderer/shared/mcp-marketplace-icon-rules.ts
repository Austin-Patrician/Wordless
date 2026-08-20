export type McpMarketplaceIconId =
  | "ai-hot"
  | "asset-management"
  | "autonomous-control"
  | "autonomous-operation-management"
  | "check-and-correct-plan"
  | "comprehensive-strategic-management"
  | "consumables-management"
  | "data-collection-and-translation"
  | "dingtalk"
  | "energy-and-carbon-management"
  | "equipment-and-facility-operation-and-maintenance"
  | "exception-event-management"
  | "feishu"
  | "figma"
  | "firecrawl"
  | "github"
  | "integrated-information-management"
  | "iot-solution-configuration"
  | "metric-board"
  | "postgresql"
  | "report-generation-management"
  | "system-global-configuration"
  | "tool-management"
  | "web-search"
  | "wecom"
  | "work-order-management";

export type McpMarketplaceIconTone =
  | "ai"
  | "automation"
  | "cloud"
  | "collaboration"
  | "data"
  | "documents"
  | "media"
  | "neutral"
  | "projects"
  | "security"
  | "source"
  | "web";

export type McpMarketplaceIconRule = {
  aliases: string[];
  id: McpMarketplaceIconId;
  label: string;
  match: "identity" | "context";
  tone: McpMarketplaceIconTone;
};

export const MCP_MARKETPLACE_DEFAULT_ICON_ID = "tool-management" satisfies McpMarketplaceIconId;

export const MCP_MARKETPLACE_ICON_RULES: readonly McpMarketplaceIconRule[] = [
  {
    id: "github",
    label: "GitHub",
    tone: "source",
    match: "identity",
    aliases: ["github"],
  },
  {
    id: "figma",
    label: "Figma",
    tone: "projects",
    match: "identity",
    aliases: ["figma"],
  },
  {
    id: "firecrawl",
    label: "Firecrawl",
    tone: "web",
    match: "identity",
    aliases: ["firecrawl"],
  },
  {
    id: "postgresql",
    label: "PostgreSQL",
    tone: "data",
    match: "identity",
    aliases: ["postgresql", "postgres"],
  },
  {
    id: "ai-hot",
    label: "AI hot",
    tone: "ai",
    match: "identity",
    aliases: ["aihot", "ai hot"],
  },
  {
    id: "web-search",
    label: "Web Search",
    tone: "web",
    match: "identity",
    aliases: ["websearch", "web search"],
  },
  {
    id: "feishu",
    label: "飞书",
    tone: "collaboration",
    match: "identity",
    aliases: ["feishu", "lark", "飞书"],
  },
  {
    id: "dingtalk",
    label: "钉钉",
    tone: "collaboration",
    match: "identity",
    aliases: ["dingtalk", "dingding", "ding talk", "钉钉"],
  },
  {
    id: "wecom",
    label: "企业微信",
    tone: "collaboration",
    match: "identity",
    aliases: ["wecom", "wechat work", "wxwork", "企业微信"],
  },
  {
    id: "energy-and-carbon-management",
    label: "Energy and carbon",
    tone: "security",
    match: "context",
    aliases: ["energy", "carbon", "climate", "emission", "emissions", "sustainability"],
  },
  {
    id: "equipment-and-facility-operation-and-maintenance",
    label: "Equipment and facilities",
    tone: "automation",
    match: "context",
    aliases: ["equipment", "facility", "facilities", "maintenance", "oee"],
  },
  {
    id: "exception-event-management",
    label: "Exception events",
    tone: "security",
    match: "context",
    aliases: ["exception", "incident", "alert", "alarm", "sentry", "pagerduty", "monitoring"],
  },
  {
    id: "iot-solution-configuration",
    label: "IoT and devices",
    tone: "cloud",
    match: "context",
    aliases: ["iot", "sensor", "mqtt", "plc", "scada", "map", "geocode", "location", "places"],
  },
  {
    id: "metric-board",
    label: "Metrics",
    tone: "data",
    match: "context",
    aliases: ["analytics", "metrics", "dashboard", "business intelligence", "kpi", "chart"],
  },
  {
    id: "work-order-management",
    label: "Work orders",
    tone: "projects",
    match: "context",
    aliases: [
      "linear",
      "jira",
      "trello",
      "asana",
      "clickup",
      "project management",
      "issue tracker",
      "kanban",
      "work order",
      "ticket",
    ],
  },
  {
    id: "consumables-management",
    label: "Consumables",
    tone: "automation",
    match: "context",
    aliases: [
      "consumable",
      "inventory",
      "supply",
      "stripe",
      "paypal",
      "payment",
      "billing",
      "invoice",
    ],
  },
  {
    id: "check-and-correct-plan",
    label: "Plans",
    tone: "ai",
    match: "context",
    aliases: ["plan", "review", "audit", "checklist", "correct"],
  },
  {
    id: "autonomous-control",
    label: "Automation",
    tone: "automation",
    match: "context",
    aliases: ["zapier", "n8n", "webhook", "workflow", "automation", "autonomous"],
  },
  {
    id: "autonomous-operation-management",
    label: "Operations",
    tone: "automation",
    match: "context",
    aliases: ["operations", "runbook", "sre"],
  },
  {
    id: "data-collection-and-translation",
    label: "Data",
    tone: "data",
    match: "context",
    aliases: [
      "mysql",
      "sqlite",
      "supabase",
      "mongodb",
      "database",
      "sql",
      "data warehouse",
      "airtable",
      "spreadsheet",
      "dataset",
      "crawl",
      "scrape",
      "collect",
      "translation",
      "etl",
      "csv",
      "image",
      "vision",
      "photo",
      "video",
      "youtube",
      "audio",
      "music",
      "podcast",
    ],
  },
  {
    id: "web-search",
    label: "Web Search",
    tone: "web",
    match: "context",
    aliases: ["web search", "brave search", "browser", "website", "openapi"],
  },
  {
    id: "report-generation-management",
    label: "Reports",
    tone: "documents",
    match: "context",
    aliases: ["document", "pdf", "markdown", "report", "export"],
  },
  {
    id: "asset-management",
    label: "Assets",
    tone: "documents",
    match: "context",
    aliases: [
      "google drive",
      "gdrive",
      "dropbox",
      "onedrive",
      "file storage",
      "filesystem",
      "storage",
      "disk",
      "directory",
      "folder",
      "asset",
    ],
  },
  {
    id: "integrated-information-management",
    label: "Information",
    tone: "collaboration",
    match: "context",
    aliases: [
      "slack",
      "discord",
      "microsoft teams",
      "mattermost",
      "chat",
      "notion",
      "confluence",
      "documentation",
      "knowledge base",
      "wiki",
      "gmail",
      "outlook",
      "email",
      "mail",
      "calendar",
      "schedule",
      "scheduling",
    ],
  },
  {
    id: "system-global-configuration",
    label: "System configuration",
    tone: "cloud",
    match: "context",
    aliases: [
      "security",
      "authentication",
      "authorization",
      "oauth",
      "secret",
      "credential",
      "config",
      "settings",
      "kubernetes",
      "docker",
      "container",
      "aws",
      "azure",
      "cloud",
      "deployment",
      "cloudflare",
      "vercel",
      "gcp",
      "google cloud",
    ],
  },
  {
    id: "comprehensive-strategic-management",
    label: "Strategy",
    tone: "ai",
    match: "context",
    aliases: [
      "strategy",
      "openai",
      "chatgpt",
      "ai",
      "llm",
      "model",
      "agent",
      "assistant",
      "embedding",
    ],
  },
  {
    id: "tool-management",
    label: "Tools",
    tone: "source",
    match: "context",
    aliases: [
      "gitlab",
      "bitbucket",
      "source control",
      "repository",
      "version control",
      "git",
      "code",
      "developer",
      "programming",
      "debug",
      "terminal",
      "ide",
      "tool",
    ],
  },
];

const DEFAULT_MCP_MARKETPLACE_ICON: McpMarketplaceIconRule = {
  id: MCP_MARKETPLACE_DEFAULT_ICON_ID,
  label: "MCP server",
  tone: "neutral",
  match: "context",
  aliases: [],
};

const REMOTE_MCP_MARKETPLACE_ICON: McpMarketplaceIconRule = {
  id: "system-global-configuration",
  label: "Remote MCP server",
  tone: "web",
  match: "context",
  aliases: [],
};

type McpMarketplaceIconIdentity = {
  capabilities?: string[];
  description?: string;
  name: string;
  packageName?: string | null;
  title: string;
  transport?: string;
};

function lastSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withoutScope = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return withoutScope.split("/").at(-1) ?? withoutScope;
}

function normalizeTokens(value: string): string {
  return ` ${value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function identityHaystack(entry: McpMarketplaceIconIdentity): string {
  return normalizeTokens(
    [
      lastSegment(entry.name),
      entry.title,
      lastSegment(entry.packageName ?? ""),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function contextHaystack(entry: McpMarketplaceIconIdentity, identity: string): string {
  return normalizeTokens(
    `${identity} ${entry.description ?? ""} ${(entry.capabilities ?? []).join(" ")}`,
  );
}

function aliasMatches(haystack: string, alias: string): boolean {
  const needle = normalizeTokens(alias).trim();
  if (!needle) return false;
  if (/^[\u4e00-\u9fff]+$/.test(needle))
    return haystack.replace(/ /g, "").includes(needle);
  return haystack.includes(` ${needle} `);
}

export function resolveMcpMarketplaceIcon(
  entry: McpMarketplaceIconIdentity,
): McpMarketplaceIconRule {
  const identity = identityHaystack(entry);
  const context = contextHaystack(entry, identity);
  const matched = MCP_MARKETPLACE_ICON_RULES.find((rule) => {
    const haystack = rule.match === "identity" ? identity : context;
    return rule.aliases.some((alias) => aliasMatches(haystack, alias));
  });
  if (matched) return matched;
  if (entry.transport === "streamable-http") return REMOTE_MCP_MARKETPLACE_ICON;
  return DEFAULT_MCP_MARKETPLACE_ICON;
}
