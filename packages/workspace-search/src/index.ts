export interface WorkspaceFindRequest {
  pattern: string;
  path?: string;
  exclude?: string | string[];
  limit?: number;
  cursor?: string;
}

export interface WorkspaceGrepRequest {
  pattern: string;
  path?: string;
  exclude?: string | string[];
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
  cursor?: string;
}

export interface WorkspaceFindItem { path: string; name: string; size: number; modifiedAt: number }
export interface WorkspaceGrepItem { path: string; line: number; column: number; text: string; contextBefore: string[]; contextAfter: string[] }
export interface WorkspaceReferenceItem { path: string; name: string; kind: "file" | "directory"; size: number; modifiedAt: number }
export interface WorkspaceSearchPage<T> { items: T[]; nextCursor?: string; total: number }

export interface WorkspaceSearchProvider {
  find(request: WorkspaceFindRequest): Promise<WorkspaceSearchPage<WorkspaceFindItem>>;
  grep(request: WorkspaceGrepRequest): Promise<WorkspaceSearchPage<WorkspaceGrepItem>>;
  searchReferences(query: string, limit?: number): Promise<WorkspaceReferenceItem[]>;
}

export interface WorkspaceSearchService {
  forRoot(rootPath: string): WorkspaceSearchProvider;
  dispose(): void;
}
