import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthResult, OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONNECTOR_OAUTH_REDIRECT_URI } from "@wordless/domain";

const authMock = vi.hoisted(() => vi.fn());

vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({ auth: authMock }));

import { ConnectorRegistry } from "../src/index.ts";

let temporaryDirectory: string | undefined;

afterEach(async () => {
  authMock.mockReset();
  vi.unstubAllGlobals();
  if (temporaryDirectory) await rm(temporaryDirectory, { force: true, recursive: true });
  temporaryDirectory = undefined;
});

describe("connector OAuth authorization", () => {
  it("uses a dynamically registered client during the first authorization-code exchange", async () => {
    authMock.mockImplementation(async (
      provider: OAuthClientProvider,
      options: { authorizationCode?: string },
    ): Promise<AuthResult> => {
      if (options.authorizationCode === undefined) {
        expect(await provider.clientInformation()).toBeUndefined();
        await provider.saveClientInformation?.({ client_id: "dynamic-client" });
        await provider.saveCodeVerifier("pkce-verifier");
        const state = await provider.state?.();
        await provider.redirectToAuthorization(new URL(`https://identity.example/authorize?state=${state}`));
        return "REDIRECT";
      }

      expect(options.authorizationCode).toBe("authorization-code");
      expect(await provider.clientInformation()).toMatchObject({ client_id: "dynamic-client" });
      expect(await provider.codeVerifier()).toBe("pkce-verifier");
      await provider.saveTokens({ access_token: "access-token", token_type: "Bearer" });
      return "AUTHORIZED";
    });

    temporaryDirectory = await mkdtemp(join(tmpdir(), "wordless-connector-oauth-"));
    const registry = new ConnectorRegistry({ configPath: join(temporaryDirectory, "connectors.json") });
    await registry.initialize();
    const connector = await registry.upsert({
      name: "OAuth MCP",
      templateId: null,
      transport: "streamable-http",
      enabled: false,
      trustedAt: null,
      command: null,
      args: [],
      cwd: null,
      environment: {},
      url: "https://mcp.example/service",
      headers: [],
      oauth: null,
    });

    const authorized = await registry.authorize(connector.id, {
      openExternal: async (authorizationUrl) => {
        const state = new URL(authorizationUrl).searchParams.get("state");
        const callback = new URL(CONNECTOR_OAUTH_REDIRECT_URI);
        callback.searchParams.set("code", "authorization-code");
        callback.searchParams.set("state", state ?? "");
        const response = await fetch(callback);
        expect(response.ok).toBe(true);
      },
    });

    expect(authMock).toHaveBeenCalledTimes(2);
    expect(authorized.status).toBe("ready");
    expect(registry.configuration(connector.id)?.oauth).toMatchObject({
      accessToken: "access-token",
      clientId: "dynamic-client",
    });
  });

  it("times out the complete authorization flow and releases the callback server", async () => {
    authMock.mockImplementation(async () => await new Promise<AuthResult>(() => {}));

    temporaryDirectory = await mkdtemp(join(tmpdir(), "wordless-connector-oauth-timeout-"));
    const registry = new ConnectorRegistry({
      configPath: join(temporaryDirectory, "connectors.json"),
      oauthAuthorizationTimeoutMs: 20,
    });
    await registry.initialize();
    const connector = await registry.upsert({
      name: "Slow OAuth MCP",
      templateId: null,
      transport: "streamable-http",
      enabled: false,
      trustedAt: null,
      command: null,
      args: [],
      cwd: null,
      environment: {},
      url: "https://mcp.example/slow",
      headers: [],
      oauth: null,
    });

    await expect(registry.authorize(connector.id, { openExternal: async () => {} }))
      .rejects.toThrow("OAuth authorization timed out");

    expect(registry.snapshot().connectors[0]).toMatchObject({
      id: connector.id,
      status: "needs-auth",
      lastError: "OAuth authorization timed out",
    });

    const retry = new ConnectorRegistry({
      configPath: join(temporaryDirectory, "retry-connectors.json"),
      oauthAuthorizationTimeoutMs: 20,
    });
    await retry.initialize();
    const retryConnector = await retry.upsert({
      name: "Retry OAuth MCP",
      templateId: null,
      transport: "streamable-http",
      enabled: false,
      trustedAt: null,
      command: null,
      args: [],
      cwd: null,
      environment: {},
      url: "https://mcp.example/retry",
      headers: [],
      oauth: null,
    });
    await expect(retry.authorize(retryConnector.id, { openExternal: async () => {} }))
      .rejects.toThrow("OAuth authorization timed out");
  });

  it("uses GitHub device authorization instead of dynamic client registration", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        device_code: "device-code",
        user_code: "ABCD-EFGH",
        verification_uri: "https://github.com/login/device",
        expires_in: 60,
        interval: 0,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "github-access-token" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    temporaryDirectory = await mkdtemp(join(tmpdir(), "wordless-connector-oauth-"));
    const registry = new ConnectorRegistry({ configPath: join(temporaryDirectory, "connectors.json") });
    await registry.initialize();
    const connector = await registry.upsert({
      name: "GitHub",
      templateId: "github",
      transport: "streamable-http",
      enabled: false,
      trustedAt: null,
      command: null,
      args: [],
      cwd: null,
      environment: {},
      url: "https://api.githubcopilot.com/mcp/",
      headers: [],
      oauth: null,
    });

    let deviceCode: { verificationUri: string; userCode: string } | undefined;
    await registry.authorize(connector.id, {
      openExternal: async () => { throw new Error("GitHub authorization should display the device code"); },
      showDeviceCode: async (info) => { deviceCode = info; },
    });

    expect(authMock).not.toHaveBeenCalled();
    expect(deviceCode).toEqual({ verificationUri: "https://github.com/login/device", userCode: "ABCD-EFGH" });
    expect(registry.configuration(connector.id)?.oauth).toMatchObject({ accessToken: "github-access-token" });
  });
});
