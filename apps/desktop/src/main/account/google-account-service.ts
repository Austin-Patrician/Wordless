import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AccountSnapshot, DesktopHostEvent } from "@wordless/protocol";
import type { CredentialVault } from "@wordless/runtime";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_ACCOUNT_CREDENTIAL_ID = "wordless.account.google";
export const GOOGLE_DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const LOGIN_TIMEOUT_MS = 5 * 60_000;

type AccountFetch = (input: string, init?: RequestInit) => Promise<Response>;

type StoredProfile = {
  version: 1;
  subject: string;
  email: string;
  name: string;
  pictureUrl: string | null;
  emailVerified: boolean;
  signedInAt: number;
};

type StoredCredential = {
  refreshToken: string;
  scopes?: string[];
};

type GoogleTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
};

type GoogleUserInfo = {
  sub?: unknown;
  email?: unknown;
  name?: unknown;
  picture?: unknown;
  email_verified?: unknown;
};

const SIGNED_OUT: AccountSnapshot = {
  status: "signed-out",
  subject: null,
  email: null,
  name: null,
  pictureUrl: null,
  emailVerified: false,
  signedInAt: null,
};

function base64Url(value: Buffer): string {
  return value.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function profileSnapshot(profile: StoredProfile, status: AccountSnapshot["status"]): AccountSnapshot {
  return {
    status,
    subject: profile.subject,
    email: profile.email,
    name: profile.name,
    pictureUrl: profile.pictureUrl,
    emailVerified: profile.emailVerified,
    signedInAt: profile.signedInAt,
  };
}

function isStoredProfile(value: unknown): value is StoredProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<StoredProfile>;
  return profile.version === 1
    && typeof profile.subject === "string"
    && typeof profile.email === "string"
    && typeof profile.name === "string"
    && (profile.pictureUrl === null || typeof profile.pictureUrl === "string")
    && typeof profile.emailVerified === "boolean"
    && typeof profile.signedInAt === "number";
}

function successPage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Wordless</title><style>body{font:14px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f6f2;color:#242421}.box{max-width:420px;padding:28px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#66665f;line-height:1.6}</style></head><body><main class="box"><h1>Wordless</h1><p>${message}</p></main></body></html>`;
}

async function googleResponseError(response: Response, operation: string): Promise<Error> {
  let code = "";
  let description = "";
  try {
    const text = await response.text();
    const payload = JSON.parse(text) as { error?: unknown; error_description?: unknown };
    if (typeof payload.error === "string") code = payload.error;
    if (typeof payload.error_description === "string") description = payload.error_description;
  } catch {
    // Google normally returns JSON; the HTTP status remains useful if it does not.
  }
  const detail = [code, description].filter(Boolean).join(": ").slice(0, 500);
  return new Error(`${operation} (${response.status})${detail ? `: ${detail}` : "."}`);
}

export class GoogleAccountService {
  private activeServer: Server | null = null;
  private loginPromise: Promise<AccountSnapshot> | null = null;
  private snapshot: AccountSnapshot = SIGNED_OUT;
  private accessToken: { value: string; expiresAt: number; scopes: Set<string> } | null = null;
  private readonly options: {
    clientId: string;
    clientSecret: string;
    credentialVault: CredentialVault;
    profilePath: string;
    send: (event: DesktopHostEvent) => void;
    fetch?: AccountFetch;
    openExternal: (url: string) => Promise<void>;
    authorizeUrl?: string;
    tokenUrl?: string;
    userInfoUrl?: string;
    loginTimeoutMs?: number;
  };

  constructor(options: {
    clientId: string;
    clientSecret: string;
    credentialVault: CredentialVault;
    profilePath: string;
    send: (event: DesktopHostEvent) => void;
    fetch?: AccountFetch;
    openExternal: (url: string) => Promise<void>;
    authorizeUrl?: string;
    tokenUrl?: string;
    userInfoUrl?: string;
    loginTimeoutMs?: number;
  }) {
    this.options = options;
  }

  async initialize(): Promise<void> {
    let profile: StoredProfile | null = null;
    try {
      const parsed = JSON.parse(await readFile(this.options.profilePath, "utf8")) as unknown;
      profile = isStoredProfile(parsed) ? parsed : null;
    } catch {
      profile = null;
    }
    if (!profile) {
      this.snapshot = SIGNED_OUT;
      return;
    }
    try {
      const credential = await this.options.credentialVault.read(GOOGLE_ACCOUNT_CREDENTIAL_ID);
      this.snapshot = profileSnapshot(profile, credential ? "signed-in" : "needs-login");
    } catch {
      this.snapshot = profileSnapshot(profile, "needs-login");
    }
  }

  getSnapshot(): AccountSnapshot {
    return { ...this.snapshot };
  }

  login(): Promise<AccountSnapshot> {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.performLogin().finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  async logout(): Promise<void> {
    await this.options.credentialVault.delete(GOOGLE_ACCOUNT_CREDENTIAL_ID);
    await unlink(this.options.profilePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    this.snapshot = SIGNED_OUT;
    this.accessToken = null;
    this.options.send({ type: "account.changed", account: this.getSnapshot() });
  }

  dispose(): void {
    this.activeServer?.close();
    this.activeServer = null;
  }

  async needsDriveAppDataAuthorization(): Promise<boolean> {
    if (this.snapshot.status !== "signed-in") return false;
    if (this.accessToken?.scopes.has(GOOGLE_DRIVE_APPDATA_SCOPE)) return false;
    const credential = await this.readStoredCredential();
    return !credential?.scopes?.includes(GOOGLE_DRIVE_APPDATA_SCOPE);
  }

  async authorizeDriveAppData(): Promise<void> {
    if (this.snapshot.status !== "signed-in") throw new Error("Sign in with Google before enabling cloud sync.");
    const clientId = this.options.clientId.trim();
    const clientSecret = this.options.clientSecret.trim();
    if (!clientId || !clientSecret) throw new Error("Google sign-in is not configured for this build.");

    const state = base64Url(randomBytes(24));
    const verifier = base64Url(randomBytes(48));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const callback = await this.createCallbackServer(state);
    try {
      const authorizeUrl = new URL(this.options.authorizeUrl ?? GOOGLE_AUTHORIZE_URL);
      authorizeUrl.searchParams.set("client_id", clientId);
      authorizeUrl.searchParams.set("redirect_uri", callback.redirectUri);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("scope", `openid email profile ${GOOGLE_DRIVE_APPDATA_SCOPE}`);
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("code_challenge", challenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      authorizeUrl.searchParams.set("access_type", "offline");
      authorizeUrl.searchParams.set("include_granted_scopes", "true");
      authorizeUrl.searchParams.set("prompt", "consent");
      const [code] = await Promise.all([callback.code, this.options.openExternal(authorizeUrl.toString())]);
      const response = await this.exchangeAuthorizationCode(code, verifier, callback.redirectUri);
      const current = await this.readStoredCredential();
      const refreshToken = typeof response.refresh_token === "string" && response.refresh_token ? response.refresh_token : current?.refreshToken;
      if (!refreshToken) throw new Error("Google did not return a refresh token for cloud sync.");
      const scopes = new Set([...(current?.scopes ?? ["openid", "email", "profile"]), GOOGLE_DRIVE_APPDATA_SCOPE]);
      await this.options.credentialVault.write(GOOGLE_ACCOUNT_CREDENTIAL_ID, JSON.stringify({ refreshToken, scopes: [...scopes] } satisfies StoredCredential));
      if (typeof response.access_token === "string" && response.access_token) this.cacheAccessToken(response.access_token, response.expires_in, scopes);
    } finally {
      callback.close();
    }
  }

  async getAccessToken(requiredScope?: string): Promise<string> {
    if (this.snapshot.status !== "signed-in") throw new Error("Google account authorization is unavailable.");
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 30_000 && (!requiredScope || this.accessToken.scopes.has(requiredScope))) return this.accessToken.value;
    const credential = await this.readStoredCredential();
    if (!credential) throw new Error("Google account authorization needs to be renewed.");
    if (requiredScope && !credential.scopes?.includes(requiredScope)) throw new Error("Google Drive permission needs to be granted.");
    const response = await (this.options.fetch ?? fetch)(this.options.tokenUrl ?? GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.options.clientId.trim(), client_secret: this.options.clientSecret.trim(), refresh_token: credential.refreshToken, grant_type: "refresh_token" }),
    });
    if (!response.ok) throw await googleResponseError(response, "Google token refresh failed");
    const tokens = await response.json() as GoogleTokenResponse;
    if (typeof tokens.access_token !== "string" || !tokens.access_token) throw new Error("Google did not return an access token.");
    const scopes = new Set(credential.scopes ?? ["openid", "email", "profile"]);
    this.cacheAccessToken(tokens.access_token, tokens.expires_in, scopes);
    return tokens.access_token;
  }

  private async performLogin(): Promise<AccountSnapshot> {
    const clientId = this.options.clientId.trim();
    if (!clientId) throw new Error("Google sign-in is not configured for this build.");
    const clientSecret = this.options.clientSecret.trim();
    if (!clientSecret) throw new Error("Google Desktop OAuth client secret is not configured for this build.");

    const state = base64Url(randomBytes(24));
    const verifier = base64Url(randomBytes(48));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const callback = await this.createCallbackServer(state);

    try {
      const authorizeUrl = new URL(this.options.authorizeUrl ?? GOOGLE_AUTHORIZE_URL);
      authorizeUrl.searchParams.set("client_id", clientId);
      authorizeUrl.searchParams.set("redirect_uri", callback.redirectUri);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("scope", "openid email profile");
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("code_challenge", challenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      authorizeUrl.searchParams.set("access_type", "offline");
      authorizeUrl.searchParams.set("prompt", "consent select_account");
      const [code] = await Promise.all([callback.code, this.options.openExternal(authorizeUrl.toString())]);
      const tokens = await this.exchangeAuthorizationCode(code, verifier, callback.redirectUri);
      if (typeof tokens.access_token !== "string" || !tokens.access_token) throw new Error("Google did not return an access token.");
      if (typeof tokens.refresh_token !== "string" || !tokens.refresh_token) throw new Error("Google did not return a refresh token. Revoke Wordless access in Google and try again.");

      const userResponse = await (this.options.fetch ?? fetch)(this.options.userInfoUrl ?? GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      if (!userResponse.ok) throw await googleResponseError(userResponse, "Google profile request failed");
      const user = await userResponse.json() as GoogleUserInfo;
      if (typeof user.sub !== "string" || typeof user.email !== "string") throw new Error("Google returned an incomplete account profile.");

      const profile: StoredProfile = {
        version: 1,
        subject: user.sub,
        email: user.email,
        name: typeof user.name === "string" && user.name.trim() ? user.name : user.email,
        pictureUrl: typeof user.picture === "string" && user.picture ? user.picture : null,
        emailVerified: user.email_verified === true,
        signedInAt: Date.now(),
      };
      const credential: StoredCredential = { refreshToken: tokens.refresh_token, scopes: ["openid", "email", "profile"] };
      await this.options.credentialVault.write(GOOGLE_ACCOUNT_CREDENTIAL_ID, JSON.stringify(credential));
      this.cacheAccessToken(tokens.access_token, tokens.expires_in, new Set(credential.scopes));
      try {
        await this.persistProfile(profile);
      } catch (error) {
        await this.options.credentialVault.delete(GOOGLE_ACCOUNT_CREDENTIAL_ID).catch(() => undefined);
        throw error;
      }
      this.snapshot = profileSnapshot(profile, "signed-in");
      this.options.send({ type: "account.changed", account: this.getSnapshot() });
      return this.getSnapshot();
    } finally {
      callback.close();
    }
  }

  private async exchangeAuthorizationCode(code: string, verifier: string, redirectUri: string): Promise<GoogleTokenResponse> {
    const response = await (this.options.fetch ?? fetch)(this.options.tokenUrl ?? GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.options.clientId.trim(), client_secret: this.options.clientSecret.trim(), code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri }),
    });
    if (!response.ok) throw await googleResponseError(response, "Google token exchange failed");
    return await response.json() as GoogleTokenResponse;
  }

  private async readStoredCredential(): Promise<StoredCredential | null> {
    const raw = await this.options.credentialVault.read(GOOGLE_ACCOUNT_CREDENTIAL_ID);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<StoredCredential>;
      return typeof value.refreshToken === "string" && value.refreshToken ? { refreshToken: value.refreshToken, scopes: Array.isArray(value.scopes) ? value.scopes.filter((scope): scope is string => typeof scope === "string") : undefined } : null;
    } catch {
      return null;
    }
  }

  private cacheAccessToken(value: string, expiresIn: unknown, scopes: Set<string>): void {
    const lifetime = typeof expiresIn === "number" && Number.isFinite(expiresIn) ? expiresIn * 1_000 : 55 * 60_000;
    this.accessToken = { value, expiresAt: Date.now() + lifetime, scopes };
  }

  private async createCallbackServer(expectedState: string): Promise<{ redirectUri: string; code: Promise<string>; close: () => void }> {
    let resolveCode!: (code: string) => void;
    let rejectCode!: (error: Error) => void;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const code = new Promise<string>((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });
    const finish = (result: { code?: string; error?: Error }) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (result.code) resolveCode(result.code);
      else rejectCode(result.error ?? new Error("Google sign-in did not complete."));
    };
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname !== "/oauth/callback") {
        response.writeHead(404).end();
        return;
      }
      const state = requestUrl.searchParams.get("state");
      const error = requestUrl.searchParams.get("error");
      const authorizationCode = requestUrl.searchParams.get("code");
      if (state !== expectedState) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(successPage("The sign-in request could not be verified. You can close this page."));
        finish({ error: new Error("Google sign-in state validation failed.") });
        return;
      }
      if (error) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(successPage("Google sign-in was cancelled. You can close this page."));
        finish({ error: new Error(error === "access_denied" ? "Google sign-in was cancelled." : `Google sign-in failed: ${error}`) });
        return;
      }
      if (!authorizationCode) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(successPage("No authorization code was returned. You can close this page."));
        finish({ error: new Error("Google did not return an authorization code.") });
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(successPage("Authorization received. Return to Wordless while sign-in finishes."));
      finish({ code: authorizationCode });
    });
    server.on("error", (error) => finish({ error }));
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
      server.listen(0, "127.0.0.1");
    });
    this.activeServer = server;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unable to start the Google sign-in callback.");
    timeout = setTimeout(() => finish({ error: new Error("Google sign-in timed out.") }), this.options.loginTimeoutMs ?? LOGIN_TIMEOUT_MS);
    return {
      redirectUri: `http://127.0.0.1:${address.port}/oauth/callback`,
      code,
      close: () => {
        if (timeout) clearTimeout(timeout);
        server.close();
        if (this.activeServer === server) this.activeServer = null;
      },
    };
  }

  private async persistProfile(profile: StoredProfile): Promise<void> {
    await mkdir(dirname(this.options.profilePath), { recursive: true });
    const temporaryPath = `${this.options.profilePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(profile), "utf8");
    await rename(temporaryPath, this.options.profilePath);
  }
}
