import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { safeStorage } from "electron";
import type { CredentialVault } from "@wordless/runtime";

type EncryptedValues = { version: 1; values: Record<string, string> };

function isEncryptedValues(value: unknown): value is EncryptedValues {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    "values" in value &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { values?: unknown }).values === "object" &&
    (value as { values?: unknown }).values !== null
  );
}

export class ElectronCredentialVault implements CredentialVault {
  private values: Record<string, string> | undefined;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async read(id: string): Promise<string | undefined> {
    const values = await this.load();
    const encrypted = values[id];
    if (!encrypted) return undefined;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system");
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  async write(id: string, value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system");
    const values = await this.load();
    values[id] = safeStorage.encryptString(value).toString("base64");
    await this.persist(values);
  }

  async delete(id: string): Promise<void> {
    const values = await this.load();
    delete values[id];
    await this.persist(values);
  }

  private async load(): Promise<Record<string, string>> {
    if (this.values) return this.values;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      this.values = isEncryptedValues(parsed) ? parsed.values : {};
    } catch {
      this.values = {};
    }
    return this.values;
  }

  private async persist(values: Record<string, string>): Promise<void> {
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify({ version: 1, values } satisfies EncryptedValues), "utf8");
    await rename(temporaryPath, this.filePath);
  }
}
