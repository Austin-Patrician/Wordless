import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DesktopProxyConfig } from "@wordless/protocol";
import { DEFAULT_PROXY_CONFIG, normalizeProxyConfig } from "./proxy-settings.ts";

/**
 * Persistence for the application proxy.
 *
 * The config and the password live in different places on purpose: the config is
 * a plain JSON file, the password goes to the credential vault, which encrypts
 * via the OS keychain. A proxy password opens the user's own network, so it is
 * held to the same standard as a stored credential.
 */

const PASSWORD_ID = "proxy-password";

/** The slice of the credential vault this needs, so tests can supply a fake. */
export interface ProxySecretStore {
  delete(id: string): Promise<void>;
  read(id: string): Promise<string | undefined>;
  write(id: string, value: string): Promise<void>;
}

export class DesktopProxyStore {
  private readonly configPath: string;
  private readonly secrets: ProxySecretStore;

  constructor(userDataPath: string, secrets: ProxySecretStore) {
    this.configPath = path.join(userDataPath, "proxy.json");
    this.secrets = secrets;
  }

  async read(): Promise<DesktopProxyConfig> {
    let stored: unknown;
    try {
      stored = JSON.parse(await readFile(this.configPath, "utf8"));
    } catch {
      // Missing or unreadable means "no proxy configured", which is the safe
      // default: it goes direct, exactly like a fresh install.
      return { ...DEFAULT_PROXY_CONFIG };
    }
    const config = normalizeProxyConfig(stored);
    const password = await this.secrets.read(PASSWORD_ID);
    return password === undefined ? config : { ...config, password };
  }

  async write(config: DesktopProxyConfig): Promise<DesktopProxyConfig> {
    const normalized = normalizeProxyConfig(config);
    const { password, ...rest } = normalized;

    if (password === "") await this.secrets.delete(PASSWORD_ID);
    else await this.secrets.write(PASSWORD_ID, password);

    // Write-then-rename: a half-written config would be read back as the
    // default and silently drop a working proxy.
    const temporary = `${this.configPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(rest, null, 2)}\n`, "utf8");
    await rename(temporary, this.configPath);

    return normalized;
  }
}
