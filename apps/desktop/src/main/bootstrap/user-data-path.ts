import { existsSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type UserDataPreparation = {
  path: string;
  notice?: string;
};

function hasEntries(directory: string): boolean {
  try {
    return readdirSync(directory).length > 0;
  } catch {
    return false;
  }
}

function hasWordlessData(directory: string): boolean {
  return existsSync(path.join(directory, "wordless.db")) || existsSync(path.join(directory, "models.json")) || existsSync(path.join(directory, "sessions"));
}

function rewriteStoredPathReferences(dataPath: string, legacyPath: string): void {
  const databasePath = path.join(dataPath, "wordless.db");
  if (!existsSync(databasePath)) return;
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("BEGIN IMMEDIATE");
    database.prepare("UPDATE sessions SET journal_path = replace(journal_path, ?, ?), runtime_root_path = replace(runtime_root_path, ?, ?)").run(legacyPath, dataPath, legacyPath, dataPath);
    database.prepare("UPDATE workspaces SET root_path = replace(root_path, ?, ?), canonical_root_path = replace(canonical_root_path, ?, ?)").run(legacyPath, dataPath, legacyPath, dataPath);
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The transaction may not have started.
    }
    throw error;
  } finally {
    database.close();
  }
}

function targetResult(targetPath: string, legacyPath: string): UserDataPreparation {
  try {
    rewriteStoredPathReferences(targetPath, legacyPath);
    return { path: targetPath };
  } catch (error) {
    return {
      path: targetPath,
      notice: `Wordless could not update migrated session paths: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function prepareUserDataPathAt(appDataRoot: string): UserDataPreparation {
  const targetPath = path.join(appDataRoot, "Wordless");
  const legacyPath = path.join(appDataRoot, "@wordless", "desktop");
  const targetHasData = hasWordlessData(targetPath);
  const legacyHasData = hasWordlessData(legacyPath);

  if (!hasEntries(targetPath) && legacyHasData) {
    let moved = false;
    try {
      if (existsSync(targetPath)) rmdirSync(targetPath);
      renameSync(legacyPath, targetPath);
      moved = true;
      rewriteStoredPathReferences(targetPath, legacyPath);
      return { path: targetPath };
    } catch (error) {
      if (moved) {
        try {
          renameSync(targetPath, legacyPath);
        } catch {
          // Preserve the most recent usable location when rollback is unavailable.
        }
      }
      return {
        path: legacyPath,
        notice: `Wordless could not migrate existing data to ${targetPath}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (targetHasData && legacyHasData) {
    return {
      path: legacyPath,
      notice: `Wordless found data in both ${legacyPath} and ${targetPath}. Existing data was left unchanged and the legacy location remains active.`,
    };
  }

  return targetResult(targetPath, legacyPath);
}
