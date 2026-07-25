import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { Type } from "typebox";
import type { AgentTool } from "@wordless/agent";
import { CONNECTOR_OAUTH_REDIRECT_URI } from "@wordless/domain";
import type {
  ConnectorCatalogSnapshot,
  ConnectorConfiguration,
  ConnectorHeader,
  ConnectorPromptSummary,
  ConnectorResourceSummary,
  ConnectorStatus,
  ConnectorSummary,
  ConnectorTemplateId,
  ConnectorToolSummary,
} from "@wordless/domain";

export type { ConnectorConfiguration } from "@wordless/domain";

export type ConnectorTemplate = {
  id: Exclude<ConnectorTemplateId, null>;
  name: string;
  description: string;
  transport: ConnectorConfiguration["transport"];
};

export type ConnectorToolPolicy = {
  agentToolName: string;
  connectorId: string;
  connectorName: string;
  toolName: string;
  readOnly: boolean;
  destructive: boolean | null;
};

export const CONNECTOR_TEMPLATES: ConnectorTemplate[] = [
  { id: "feishu", name: "飞书", description: "为飞书开放平台 MCP 服务配置连接。", transport: "streamable-http" },
  { id: "dingtalk", name: "钉钉", description: "为钉钉开放平台 MCP 服务配置连接。", transport: "streamable-http" },
  { id: "wecom", name: "企业微信", description: "为企业微信开放平台 MCP 服务配置连接。", transport: "streamable-http" },
  { id: "postgresql", name: "PostgreSQL", description: "通过本地或远程 MCP 服务访问 PostgreSQL。", transport: "stdio" },
  { id: "web-search", name: "Web Search", description: "为搜索服务 MCP Server 配置连接。", transport: "streamable-http" },
];

type PersistedConnector = {
  configuration: ConnectorConfiguration;
  status: ConnectorStatus;
  lastError?: string;
  tools: ConnectorToolSummary[];
  resources: ConnectorResourceSummary[];
  prompts: ConnectorPromptSummary[];
};

type PersistedStore = {
  connectors: PersistedConnector[];
};

export type ConnectorRegistryOptions = {
  configPath: string;
};

export type ConnectorAuthorizationCallbacks = {
  openExternal(url: string): Promise<void> | void;
};

type McpClient = {
  client: Client;
  close: () => Promise<void>;
};

type OAuthCallbackServer = {
  redirectUrl: string;
  waitForResult: Promise<{ code?: string; error?: string }>;
  close(): Promise<void>;
};

function emptyCatalog(): ConnectorCatalogSnapshot {
  return { connectors: [], updatedAt: 0 };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asHeaders(value: unknown): ConnectorHeader[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      const record = asRecord(item);
      return typeof record?.name === "string" && typeof record.value === "string" && record.name.trim()
        ? [{ name: record.name, value: record.value }]
        : [];
    })
    : [];
}

function readConfiguration(value: unknown): ConnectorConfiguration | undefined {
  const record = asRecord(value);
  if (!record || typeof record.id !== "string" || typeof record.name !== "string") return undefined;
  if (record.transport !== "stdio" && record.transport !== "streamable-http") return undefined;
  const templateId = record.templateId === "feishu" || record.templateId === "dingtalk" || record.templateId === "wecom" || record.templateId === "postgresql" || record.templateId === "web-search" ? record.templateId : null;
  const environment = asRecord(record.environment) ?? {};
  const oauth = asRecord(record.oauth);
  return {
    id: record.id,
    name: record.name.trim(),
    templateId,
    transport: record.transport,
    enabled: record.enabled === true,
    trustedAt: typeof record.trustedAt === "number" ? record.trustedAt : null,
    command: asString(record.command) ?? null,
    args: asStringArray(record.args),
    cwd: asString(record.cwd) ?? null,
    environment: Object.fromEntries(Object.entries(environment).flatMap(([key, item]) => typeof item === "string" ? [[key, item]] : [])),
    url: asString(record.url) ?? null,
    headers: asHeaders(record.headers),
    oauth: oauth && Object.keys(oauth).some((key) => ["clientId", "clientSecret", "scope", "accessToken", "refreshToken", "expiresAt"].includes(key))
      ? {
        ...(typeof oauth.clientId === "string" ? { clientId: oauth.clientId } : {}),
        ...(typeof oauth.clientSecret === "string" ? { clientSecret: oauth.clientSecret } : {}),
        ...(typeof oauth.scope === "string" ? { scope: oauth.scope } : {}),
        ...(typeof oauth.accessToken === "string" ? { accessToken: oauth.accessToken } : {}),
        ...(typeof oauth.refreshToken === "string" ? { refreshToken: oauth.refreshToken } : {}),
        ...(typeof oauth.expiresAt === "number" ? { expiresAt: oauth.expiresAt } : {}),
      }
      : null,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
  };
}

function toolSummary(value: unknown): ConnectorToolSummary | undefined {
  const record = asRecord(value);
  if (!record || typeof record.name !== "string") return undefined;
  const annotations = asRecord(record.annotations);
  return {
    name: record.name,
    title: typeof record.title === "string" ? record.title : record.name,
    description: typeof record.description === "string" ? record.description : "",
    readOnly: typeof annotations?.readOnlyHint === "boolean" ? annotations.readOnlyHint : null,
    destructive: typeof annotations?.destructiveHint === "boolean" ? annotations.destructiveHint : null,
  };
}

function resourceSummary(value: unknown): ConnectorResourceSummary | undefined {
  const record = asRecord(value);
  if (!record || typeof record.uri !== "string" || typeof record.name !== "string") return undefined;
  return { uri: record.uri, name: record.name, description: typeof record.description === "string" ? record.description : "", mimeType: typeof record.mimeType === "string" ? record.mimeType : null };
}

function promptSummary(value: unknown): ConnectorPromptSummary | undefined {
  const record = asRecord(value);
  if (!record || typeof record.name !== "string") return undefined;
  const args = Array.isArray(record.arguments) ? record.arguments.flatMap((argument) => {
    const item = asRecord(argument);
    return item && typeof item.name === "string" ? [{ name: item.name, description: typeof item.description === "string" ? item.description : "", required: item.required === true }] : [];
  }) : [];
  return { name: record.name, title: typeof record.title === "string" ? record.title : record.name, description: typeof record.description === "string" ? record.description : "", arguments: args };
}

function defined<T>(value: T | undefined): T[] {
  return value === undefined ? [] : [value];
}

function summary(value: PersistedConnector): ConnectorSummary {
  return {
    id: value.configuration.id,
    name: value.configuration.name,
    templateId: value.configuration.templateId,
    transport: value.configuration.transport,
    enabled: value.configuration.enabled,
    trustedAt: value.configuration.trustedAt,
    status: value.status,
    ...(value.lastError ? { lastError: value.lastError } : {}),
    tools: value.tools,
    resources: value.resources,
    prompts: value.prompts,
    updatedAt: value.configuration.updatedAt,
  };
}

function toolName(connectorId: string, name: string): string {
  const clean = (value: string) => value.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return `mcp_${clean(connectorId)}_${clean(name)}`.slice(0, 120);
}

function textFromToolResult(value: unknown): string {
  const result = asRecord(value);
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content.flatMap((item) => {
    const block = asRecord(item);
    if (block?.type === "text" && typeof block.text === "string") return [block.text];
    if (block?.type === "resource" && asRecord(block.resource)?.text && typeof asRecord(block.resource)?.text === "string") return [asRecord(block.resource)?.text as string];
    if (block?.type === "resource_link" && typeof block.name === "string" && typeof block.uri === "string") return [`${block.name}: ${block.uri}`];
    return [];
  });
  if (text.length > 0) return text.join("\n\n");
  return typeof result?.structuredContent === "object" ? JSON.stringify(result.structuredContent) : "Connector completed without text output.";
}

export class ConnectorRegistry {
  private readonly configPath: string;
  private entries: PersistedConnector[] = [];
  private snapshotValue = emptyCatalog();
  private readonly listeners = new Set<() => void>();

  constructor(options: ConnectorRegistryOptions) {
    this.configPath = options.configPath;
  }

  async initialize(): Promise<void> {
    this.entries = await this.readStore();
    this.publish();
  }

  snapshot(): ConnectorCatalogSnapshot {
    return this.snapshotValue;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  configuration(id: string): ConnectorConfiguration | undefined {
    return this.entries.find((entry) => entry.configuration.id === id)?.configuration;
  }

  async upsert(configuration: Omit<ConnectorConfiguration, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<ConnectorSummary> {
    this.assertConfiguration(configuration);
    const current = configuration.id ? this.entries.find((entry) => entry.configuration.id === configuration.id) : undefined;
    const now = Date.now();
    const next: ConnectorConfiguration = {
      ...configuration,
      id: current?.configuration.id ?? randomUUID(),
      createdAt: current?.configuration.createdAt ?? now,
      updatedAt: now,
    };
    const entry: PersistedConnector = current
      ? { ...current, configuration: next, status: "disconnected", lastError: undefined }
      : { configuration: next, status: "disconnected", tools: [], resources: [], prompts: [] };
    this.entries = current ? this.entries.map((candidate) => candidate === current ? entry : candidate) : [...this.entries, entry];
    await this.writeStore();
    this.publish();
    return summary(entry);
  }

  async remove(id: string): Promise<void> {
    this.entries = this.entries.filter((entry) => entry.configuration.id !== id);
    await this.writeStore();
    this.publish();
  }

  async setEnabled(id: string, enabled: boolean): Promise<ConnectorSummary> {
    const entry = this.require(id);
    entry.configuration = { ...entry.configuration, enabled, updatedAt: Date.now() };
    await this.writeStore();
    this.publish();
    return summary(entry);
  }

  async trust(id: string): Promise<ConnectorSummary> {
    const entry = this.require(id);
    entry.configuration = { ...entry.configuration, trustedAt: Date.now(), updatedAt: Date.now() };
    await this.writeStore();
    this.publish();
    return summary(entry);
  }

  async test(id: string): Promise<ConnectorSummary> {
    const entry = this.require(id);
    if (entry.configuration.transport === "stdio" && entry.configuration.trustedAt === null) {
      throw new Error("Trust this local Connector before starting its command");
    }
    try {
      const connection = await this.open(entry.configuration);
      try {
        const [tools, resources, prompts] = await Promise.all([
          connection.client.listTools().catch(() => ({ tools: [] })),
          connection.client.listResources().catch(() => ({ resources: [] })),
          connection.client.listPrompts().catch(() => ({ prompts: [] })),
        ]);
        entry.tools = tools.tools.flatMap((tool) => defined(toolSummary(tool)));
        entry.resources = resources.resources.flatMap((resource) => defined(resourceSummary(resource)));
        entry.prompts = prompts.prompts.flatMap((prompt) => defined(promptSummary(prompt)));
        entry.status = "ready";
        entry.lastError = undefined;
      } finally {
        await connection.close();
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      entry.status = /unauthori[sz]ed|oauth|authentication/i.test(message) ? "needs-auth" : "error";
      entry.lastError = message;
    }
    entry.configuration = { ...entry.configuration, updatedAt: Date.now() };
    await this.writeStore();
    this.publish();
    return summary(entry);
  }

  async authorize(id: string, callbacks: ConnectorAuthorizationCallbacks): Promise<ConnectorSummary> {
    const entry = this.require(id);
    if (entry.configuration.transport !== "streamable-http" || !entry.configuration.url) {
      throw new Error("OAuth authorization is only available for remote Streamable HTTP connectors");
    }
    const state = randomUUID();
    const callbackServer = await this.createOAuthCallbackServer(state);
    try {
      const provider = this.createOAuthProvider(entry, callbackServer.redirectUrl, state, callbacks);
      const result = await auth(provider, { serverUrl: entry.configuration.url });
      if (result === "REDIRECT") {
        const callback = await callbackServer.waitForResult;
        if (callback.error) throw new Error(`OAuth authorization failed: ${callback.error}`);
        if (!callback.code) throw new Error("OAuth authorization did not return a code");
        await auth(provider, { serverUrl: entry.configuration.url, authorizationCode: callback.code });
      }
      entry.status = "ready";
      entry.lastError = undefined;
      entry.configuration = { ...entry.configuration, updatedAt: Date.now() };
      await this.writeStore();
      this.publish();
      return summary(entry);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      entry.status = "needs-auth";
      entry.lastError = message;
      await this.writeStore();
      this.publish();
      throw cause;
    } finally {
      await callbackServer.close();
    }
  }

  createTools(ids: readonly string[]): AgentTool[] {
    return ids.flatMap((id) => {
      const entry = this.entries.find((candidate) => candidate.configuration.id === id && candidate.configuration.enabled && candidate.status === "ready");
      if (!entry) return [];
      return entry.tools.map((tool) => ({
        name: toolName(entry.configuration.id, tool.name),
        label: `${entry.configuration.name}: ${tool.title}`,
        description: tool.description || `Run ${tool.name} through ${entry.configuration.name}.`,
        parameters: Type.Unsafe<Record<string, unknown>>({ type: "object", additionalProperties: true }),
        execute: async (_callId: string, params: unknown, signal?: AbortSignal) => {
          const argumentsValue = asRecord(params);
          if (!argumentsValue) {
            return { content: [{ type: "text", text: "Connector tool arguments must be an object." }], details: {}, isError: true };
          }
          const result = await this.callTool(entry.configuration.id, tool.name, argumentsValue, signal);
          return {
            content: [{ type: "text", text: textFromToolResult(result) }],
            details: { connectorId: entry.configuration.id, connectorName: entry.configuration.name, toolName: tool.name, result },
            isError: asRecord(result)?.isError === true,
          };
        },
      }));
    });
  }

  createToolPolicies(ids: readonly string[]): ConnectorToolPolicy[] {
    return ids.flatMap((id) => {
      const entry = this.entries.find((candidate) => candidate.configuration.id === id && candidate.configuration.enabled && candidate.status === "ready");
      if (!entry) return [];
      return entry.tools.map((tool) => ({
        agentToolName: toolName(entry.configuration.id, tool.name),
        connectorId: entry.configuration.id,
        connectorName: entry.configuration.name,
        toolName: tool.name,
        readOnly: tool.readOnly === true,
        destructive: tool.destructive,
      }));
    });
  }

  async callTool(id: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const entry = this.require(id);
    const connection = await this.open(entry.configuration);
    try {
      return await connection.client.callTool({ name, arguments: args }, undefined, { signal });
    } finally {
      await connection.close();
    }
  }

  async listResources(id: string): Promise<ConnectorResourceSummary[]> {
    const entry = this.require(id);
    const connection = await this.open(entry.configuration);
    try {
      const resources = await connection.client.listResources();
      return resources.resources.flatMap((resource) => defined(resourceSummary(resource)));
    } finally {
      await connection.close();
    }
  }

  async readResource(id: string, uri: string): Promise<{ uri: string; content: string; mimeType: string | null }> {
    const entry = this.require(id);
    const connection = await this.open(entry.configuration);
    try {
      const result = await connection.client.readResource({ uri });
      const content = result.contents.map((item) => "text" in item ? item.text : Buffer.from(item.blob, "base64").toString("utf8")).join("\n\n");
      const mimeType = result.contents.find((item) => item.mimeType)?.mimeType ?? null;
      return { uri, content, mimeType };
    } finally {
      await connection.close();
    }
  }

  async listPrompts(id: string): Promise<ConnectorPromptSummary[]> {
    const entry = this.require(id);
    const connection = await this.open(entry.configuration);
    try {
      const prompts = await connection.client.listPrompts();
      return prompts.prompts.flatMap((prompt) => defined(promptSummary(prompt)));
    } finally {
      await connection.close();
    }
  }

  async getPrompt(id: string, name: string, argumentsValue: Record<string, string>): Promise<string> {
    const entry = this.require(id);
    const connection = await this.open(entry.configuration);
    try {
      const prompt = await connection.client.getPrompt({ name, arguments: argumentsValue });
      return prompt.messages.flatMap((message) => message.content.type === "text" ? [message.content.text] : []).join("\n\n");
    } finally {
      await connection.close();
    }
  }

  private async open(configuration: ConnectorConfiguration): Promise<McpClient> {
    const current = this.require(configuration.id);
    await this.refreshOAuthTokenIfNeeded(current);
    const activeConfiguration = current.configuration;
    const client = new Client({ name: "Wordless", version: "0.1.0" }, { capabilities: { roots: { listChanged: true }, sampling: {}, elicitation: { form: {}, url: {} } } });
    const transport = activeConfiguration.transport === "stdio"
      ? new StdioClientTransport({ command: activeConfiguration.command!, args: activeConfiguration.args, ...(activeConfiguration.cwd ? { cwd: activeConfiguration.cwd } : {}), env: { ...Object.fromEntries(Object.entries(process.env).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : [])), ...activeConfiguration.environment }, stderr: "pipe" })
      : new StreamableHTTPClientTransport(new URL(activeConfiguration.url!), {
        requestInit: {
          headers: Object.fromEntries([
            ...activeConfiguration.headers.map((header) => [header.name, header.value]),
            ...(activeConfiguration.oauth?.accessToken ? [["Authorization", `Bearer ${activeConfiguration.oauth.accessToken}`]] : []),
          ]),
        },
      });
    await client.connect(transport);
    return { client, close: async () => await transport.close() };
  }

  private async refreshOAuthTokenIfNeeded(entry: PersistedConnector): Promise<void> {
    const oauth = entry.configuration.oauth;
    if (entry.configuration.transport !== "streamable-http" || !entry.configuration.url || !oauth?.accessToken || !oauth.refreshToken || !oauth.expiresAt || oauth.expiresAt > Date.now() + 60_000) return;
    const provider = this.createOAuthProvider(entry, "http://127.0.0.1/oauth/refresh", randomUUID(), {
      openExternal: () => { throw new Error("Connector OAuth authorization expired. Reconnect this connector from Skills & Connectors."); },
    });
    await auth(provider, { serverUrl: entry.configuration.url });
    entry.configuration = { ...entry.configuration, updatedAt: Date.now() };
    await this.writeStore();
    this.publish();
  }

  private createOAuthProvider(entry: PersistedConnector, redirectUrl: string, state: string, callbacks: ConnectorAuthorizationCallbacks): OAuthClientProvider {
    const configuration = entry.configuration;
    const oauth = configuration.oauth;
    let codeVerifier: string | undefined;
    const provider: OAuthClientProvider = {
      redirectUrl,
      state: () => state,
      clientMetadata: {
        redirect_uris: [redirectUrl],
        client_name: "Wordless",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: oauth?.clientSecret ? "client_secret_post" : "none",
        ...(oauth?.scope ? { scope: oauth.scope } : {}),
      } satisfies OAuthClientMetadata,
      clientInformation: (): OAuthClientInformationMixed | undefined => oauth?.clientId
        ? { client_id: oauth.clientId, ...(oauth.clientSecret ? { client_secret: oauth.clientSecret } : {}) }
        : undefined,
      saveClientInformation: async (information) => {
        entry.configuration = {
          ...entry.configuration,
          oauth: { ...(entry.configuration.oauth ?? {}), clientId: information.client_id, ...(information.client_secret ? { clientSecret: information.client_secret } : {}) },
          updatedAt: Date.now(),
        };
        await this.writeStore();
      },
      tokens: (): OAuthTokens | undefined => {
        const current = entry.configuration.oauth;
        if (!current?.accessToken) return undefined;
        const expiresIn = current.expiresAt ? Math.max(0, Math.floor((current.expiresAt - Date.now()) / 1_000)) : undefined;
        return { access_token: current.accessToken, token_type: "Bearer", ...(current.refreshToken ? { refresh_token: current.refreshToken } : {}), ...(expiresIn !== undefined ? { expires_in: expiresIn } : {}) };
      },
      saveTokens: async (tokens) => {
        entry.configuration = {
          ...entry.configuration,
          oauth: {
            ...(entry.configuration.oauth ?? {}),
            accessToken: tokens.access_token,
            ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
            ...(tokens.expires_in !== undefined ? { expiresAt: Date.now() + Number(tokens.expires_in) * 1_000 } : {}),
          },
          updatedAt: Date.now(),
        };
        await this.writeStore();
      },
      saveCodeVerifier: (value) => { codeVerifier = value; },
      codeVerifier: () => codeVerifier ?? "",
      redirectToAuthorization: (url) => callbacks.openExternal(String(url)),
    };
    return provider;
  }

  private async createOAuthCallbackServer(expectedState: string): Promise<OAuthCallbackServer> {
    let resolveResult: (result: { code?: string; error?: string }) => void = () => {};
    const waitForResult = new Promise<{ code?: string; error?: string }>((resolve) => { resolveResult = resolve; });
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/oauth/callback") {
        response.writeHead(404);
        response.end();
        return;
      }
      const code = url.searchParams.get("code") ?? undefined;
      const error = url.searchParams.get("error") ?? undefined;
      const state = url.searchParams.get("state");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      if (state !== expectedState) {
        response.end("<html><body><p>Wordless authorization was rejected because the OAuth state did not match.</p></body></html>");
        resolveResult({ error: "OAuth state did not match" });
        return;
      }
      response.end("<html><body><p>Wordless authorization received. You can return to the app.</p></body></html>");
      resolveResult({ code, error });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(18191, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw new Error("Unable to start the OAuth callback server");
    }
    return {
      redirectUrl: CONNECTOR_OAUTH_REDIRECT_URI,
      waitForResult,
      close: async () => await new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  private require(id: string): PersistedConnector {
    const entry = this.entries.find((candidate) => candidate.configuration.id === id);
    if (!entry) throw new Error("Connector was not found");
    return entry;
  }

  private assertConfiguration(configuration: Omit<ConnectorConfiguration, "id" | "createdAt" | "updatedAt"> & { id?: string }): void {
    if (!configuration.name.trim()) throw new Error("Connector name is required");
    if (configuration.transport === "stdio" && !configuration.command?.trim()) throw new Error("A local Connector command is required");
    if (configuration.transport === "streamable-http") {
      if (!configuration.url?.trim()) throw new Error("A remote Connector URL is required");
      try {
        new URL(configuration.url);
      } catch {
        throw new Error("The remote Connector URL is invalid");
      }
    }
  }

  private async readStore(): Promise<PersistedConnector[]> {
    try {
      const value = JSON.parse(await readFile(this.configPath, "utf8")) as unknown;
      const store = asRecord(value);
      const raw = Array.isArray(store?.connectors) ? store.connectors : [];
      return raw.flatMap((item) => {
        const record = asRecord(item);
        const configuration = readConfiguration(record?.configuration);
        if (!configuration) return [];
        return [{
          configuration,
          status: record?.status === "ready" || record?.status === "needs-auth" || record?.status === "error" ? record.status : "disconnected",
          ...(typeof record?.lastError === "string" ? { lastError: record.lastError } : {}),
          tools: Array.isArray(record?.tools) ? record.tools.flatMap((tool) => defined(toolSummary(tool))) : [],
          resources: Array.isArray(record?.resources) ? record.resources.flatMap((resource) => defined(resourceSummary(resource))) : [],
          prompts: Array.isArray(record?.prompts) ? record.prompts.flatMap((prompt) => defined(promptSummary(prompt))) : [],
        }];
      });
    } catch {
      return [];
    }
  }

  private async writeStore(): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    const store: PersistedStore = { connectors: this.entries };
    await writeFile(this.configPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }

  private publish(): void {
    this.snapshotValue = { connectors: this.entries.map((entry) => summary(entry)), updatedAt: Date.now() };
    for (const listener of this.listeners) listener();
  }
}
