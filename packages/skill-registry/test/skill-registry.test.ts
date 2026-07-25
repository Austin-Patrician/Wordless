import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceRecord } from "@wordless/domain";
import { SkillRegistry } from "../src/index.ts";

const temporaryRoots: string[] = [];

async function writeSkill(root: string, name: string, description = "Useful skill"): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`, "utf8");
}

function workspace(root: string): WorkspaceRecord {
  return {
    id: "workspace-1",
    kind: "linked",
    name: "Workspace",
    rootPath: root,
    canonicalRootPath: root,
    availability: "available",
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })));
});

describe("SkillRegistry", () => {
  it("strictly validates sources and resolves workspace and disabled fallbacks", async () => {
    const root = await mkdtemp(join(tmpdir(), "wordless-skill-registry-"));
    temporaryRoots.push(root);
    const home = join(root, "home");
    const managed = join(root, "managed");
    const workspaceRoot = join(root, "workspace");
    await writeSkill(join(managed, "shared"), "shared");
    await writeSkill(join(home, ".pi", "agent", "skills", "shared"), "shared", "Pi variant");
    await writeSkill(join(workspaceRoot, ".pi", "skills", "shared"), "shared", "Workspace variant");
    await mkdir(join(home, ".claude", "skills", "invalid"), { recursive: true });
    await writeFile(join(home, ".claude", "skills", "invalid", "SKILL.md"), "---\ndescription: Missing name\n---\n", "utf8");

    const registry = new SkillRegistry({ paths: { configPath: join(root, "skills.json"), managedRoot: managed }, homeDir: home });
    await registry.initialize([workspace(workspaceRoot)]);
    try {
      const first = registry.snapshot();
      const managedSkill = first.skills.find((skill) => skill.source === "wordless" && skill.name === "shared");
      const piSkill = first.skills.find((skill) => skill.source === "pi" && skill.name === "shared");
      expect(managedSkill?.state).toBe("active");
      expect(piSkill?.state).toBe("shadowed");
      expect(first.skills.some((skill) => skill.state === "invalid" && skill.source === "claude")).toBe(true);
      expect(registry.getSessionSkills("workspace-1").find((skill) => skill.name === "shared")?.description).toBe("Workspace variant");

      await registry.setEnabled(managedSkill!.id, false);
      expect(registry.getSessionSkills(null).find((skill) => skill.name === "shared")?.description).toBe("Pi variant");
    } finally {
      registry.dispose();
    }
  });
});
