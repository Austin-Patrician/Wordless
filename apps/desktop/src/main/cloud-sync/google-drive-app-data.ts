import { GOOGLE_DRIVE_APPDATA_SCOPE, GoogleAccountService } from "../account/google-account-service.ts";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

type DriveFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type DriveAppDataFile = {
  id: string;
  name: string;
  modifiedTime: string;
  version: string;
};

function driveError(status: number, operation: string): Error {
  const error = new Error(`${operation} (${status}).`);
  Object.assign(error, { status, retryable: status === 429 || status >= 500 });
  return error;
}

export class GoogleDriveAppData {
  private readonly account: GoogleAccountService;
  private readonly fetch: DriveFetch;

  constructor(account: GoogleAccountService, fetch: DriveFetch) {
    this.account = account;
    this.fetch = fetch;
  }

  async list(): Promise<DriveAppDataFile[]> {
    const query = new URLSearchParams({ spaces: "appDataFolder", fields: "files(id,name,modifiedTime,version)", pageSize: "100" });
    const response = await this.request(`${DRIVE_API}/files?${query}`);
    if (!response.ok) throw driveError(response.status, "Google Drive file listing failed");
    const payload = await response.json() as { files?: unknown };
    return Array.isArray(payload.files) ? payload.files.filter(isDriveFile) : [];
  }

  async read(fileId: string): Promise<unknown> {
    const response = await this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`);
    if (!response.ok) throw driveError(response.status, "Google Drive file download failed");
    return await response.json();
  }

  async write(name: string, value: unknown, fileId?: string): Promise<DriveAppDataFile> {
    const boundary = `wordless-${Date.now().toString(36)}`;
    const metadata = fileId ? { name } : { name, parents: ["appDataFolder"] };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(value)}\r\n--${boundary}--`;
    const target = fileId ? `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,modifiedTime,version` : `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,modifiedTime,version`;
    const response = await this.request(target, { method: fileId ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
    if (!response.ok) throw driveError(response.status, "Google Drive file upload failed");
    const result = await response.json() as unknown;
    if (!isDriveFile(result)) throw new Error("Google Drive returned invalid file metadata.");
    return result;
  }

  async delete(fileId: string): Promise<void> {
    const response = await this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) throw driveError(response.status, "Google Drive file deletion failed");
  }

  private async request(input: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.account.getAccessToken(GOOGLE_DRIVE_APPDATA_SCOPE);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      return await this.fetch(input, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers }, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isDriveFile(value: unknown): value is DriveAppDataFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<DriveAppDataFile>;
  return typeof file.id === "string" && typeof file.name === "string" && typeof file.modifiedTime === "string" && (typeof file.version === "string" || typeof file.version === "number");
}
