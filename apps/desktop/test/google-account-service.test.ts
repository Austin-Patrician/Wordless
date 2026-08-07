import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { CredentialVault } from "@wordless/runtime";
import type { DesktopHostEvent } from "@wordless/protocol";
import { GoogleAccountService } from "../src/main/account/google-account-service.ts";

class MemoryVault implements CredentialVault {
  readonly values = new Map<string, string>();
  async read(id: string): Promise<string | undefined> { return this.values.get(id); }
  async write(id: string, value: string): Promise<void> { this.values.set(id, value); }
  async delete(id: string): Promise<void> { this.values.delete(id); }
}

test("completes Google PKCE login and keeps tokens out of the public snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "wordless-account-"));
  const vault = new MemoryVault();
  const events: DesktopHostEvent[] = [];
  let authorizeRequest: URL | null = null;
  const service = new GoogleAccountService({
    clientId: "desktop-client.apps.googleusercontent.com",
    clientSecret: "desktop-client-secret",
    credentialVault: vault,
    profilePath: join(root, "profile.json"),
    send: (event) => events.push(event),
    authorizeUrl: "https://accounts.example/authorize",
    tokenUrl: "https://accounts.example/token",
    userInfoUrl: "https://accounts.example/userinfo",
    openExternal: async (url) => {
      authorizeRequest = new URL(url);
      const callback = new URL(authorizeRequest.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", authorizeRequest.searchParams.get("state")!);
      callback.searchParams.set("code", "authorization-code");
      const response = await fetch(callback);
      assert.equal(response.status, 200);
    },
    fetch: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/token")) {
        assert.equal(init?.method, "POST");
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("code"), "authorization-code");
        assert.equal(body.get("client_secret"), "desktop-client-secret");
        assert.ok(body.get("code_verifier"));
        return Response.json({ access_token: "access-secret", refresh_token: "refresh-secret" });
      }
      if (url.endsWith("/userinfo")) return Response.json({ sub: "google-subject", email: "mina@example.com", name: "Mina Ahn", picture: "https://images.example/mina.png", email_verified: true });
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  try {
    await service.initialize();
    assert.equal(service.getSnapshot().status, "signed-out");
    const snapshot = await service.login();
    assert.equal(authorizeRequest?.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorizeRequest?.searchParams.get("scope"), "openid email profile");
    assert.deepEqual(snapshot, {
      status: "signed-in",
      subject: "google-subject",
      email: "mina@example.com",
      name: "Mina Ahn",
      pictureUrl: "https://images.example/mina.png",
      emailVerified: true,
      signedInAt: snapshot.signedInAt,
    });
    assert.equal("accessToken" in snapshot, false);
    assert.match(vault.values.get("wordless.account.google") ?? "", /refresh-secret/);
    assert.doesNotMatch(await readFile(join(root, "profile.json"), "utf8"), /access-secret|refresh-secret/);
    assert.equal(events.at(-1)?.type, "account.changed");

    await service.logout();
    assert.equal(service.getSnapshot().status, "signed-out");
    assert.equal(vault.values.size, 0);
  } finally {
    service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects callbacks with a mismatched OAuth state", async () => {
  const root = await mkdtemp(join(tmpdir(), "wordless-account-state-"));
  const service = new GoogleAccountService({
    clientId: "desktop-client.apps.googleusercontent.com",
    clientSecret: "desktop-client-secret",
    credentialVault: new MemoryVault(),
    profilePath: join(root, "profile.json"),
    send: () => undefined,
    openExternal: async (url) => {
      const callback = new URL(new URL(url).searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", "wrong-state");
      callback.searchParams.set("code", "authorization-code");
      await fetch(callback);
    },
  });
  try {
    await assert.rejects(service.login(), /state validation failed/);
    assert.equal(service.getSnapshot().status, "signed-out");
  } finally {
    service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("surfaces Google's OAuth error description when token exchange fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "wordless-account-token-error-"));
  const service = new GoogleAccountService({
    clientId: "desktop-client.apps.googleusercontent.com",
    clientSecret: "desktop-client-secret",
    credentialVault: new MemoryVault(),
    profilePath: join(root, "profile.json"),
    send: () => undefined,
    openExternal: async (url) => {
      const request = new URL(url);
      const callback = new URL(request.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", request.searchParams.get("state")!);
      callback.searchParams.set("code", "authorization-code");
      await fetch(callback);
    },
    fetch: async () => Response.json(
      { error: "invalid_client", error_description: "The OAuth client was not found." },
      { status: 400 },
    ),
  });
  try {
    await assert.rejects(service.login(), /invalid_client: The OAuth client was not found/);
  } finally {
    service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("requests Drive app-data permission only when cloud sync is authorized", async () => {
  const root = await mkdtemp(join(tmpdir(), "wordless-account-drive-"));
  const vault = new MemoryVault();
  const scopes: string[] = [];
  let tokenRequests = 0;
  const service = new GoogleAccountService({
    clientId: "desktop-client.apps.googleusercontent.com",
    clientSecret: "desktop-client-secret",
    credentialVault: vault,
    profilePath: join(root, "profile.json"),
    send: () => undefined,
    openExternal: async (url) => {
      const request = new URL(url);
      scopes.push(request.searchParams.get("scope") ?? "");
      const callback = new URL(request.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", request.searchParams.get("state")!);
      callback.searchParams.set("code", `authorization-${scopes.length}`);
      await fetch(callback);
    },
    fetch: async (input) => {
      if (String(input).endsWith("/userinfo")) return Response.json({ sub: "subject", email: "user@example.com", email_verified: true });
      tokenRequests += 1;
      return Response.json({ access_token: `access-${tokenRequests}`, refresh_token: `refresh-${tokenRequests}`, expires_in: 3600 });
    },
    tokenUrl: "https://accounts.example/token",
    userInfoUrl: "https://accounts.example/userinfo",
  });
  try {
    await service.login();
    assert.equal(scopes[0], "openid email profile");
    assert.equal(await service.needsDriveAppDataAuthorization(), true);
    await service.authorizeDriveAppData();
    assert.match(scopes[1] ?? "", /drive\.appdata/);
    assert.match(vault.values.get("wordless.account.google") ?? "", /drive\.appdata/);
    assert.equal(await service.needsDriveAppDataAuthorization(), false);
  } finally {
    service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
