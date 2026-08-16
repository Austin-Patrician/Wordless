import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SkillsMpMarketplaceService } from "../src/main/marketplace/skillsmp-marketplace-service.ts";

const skill = {
  id: "example-skills-productivity-skill-md",
  name: "productivity",
  author: "example",
  description: "Plan focused work.",
  contentLanguage: "en",
  githubUrl: "https://github.com/example/skills/tree/main/skills/productivity",
  skillUrl: "https://skillsmp.com/creators/example/skills/skills-productivity",
  stars: 42,
  updatedAt: 1_765_000_000,
};

const commitSha = "1234567890abcdef1234567890abcdef12345678";
const skillMarkdown = "---\nname: productivity\ndescription: Plan focused work.\n---\n\n# Productivity\n";

function searchResponse(): Response {
  return new Response(JSON.stringify({
    success: true,
    data: { skills: [skill], pagination: { page: 1, total: 1, totalPages: 1, hasNext: false } },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("searches SkillsMP with authentication and caches the normalized page", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wordless-skillsmp-"));
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    return searchResponse();
  };
  try {
    const service = new SkillsMpMarketplaceService(root, { apiKey: "shared-key", fetch: fetchImpl });
    const first = await service.search("productivity");
    const cached = await service.search("productivity");
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.authorization, "Bearer shared-key");
    assert.match(requests[0]?.url ?? "", /q=productivity/);
    assert.equal(first.entries[0]?.source, "skillsmp");
    assert.equal(first.entries[0]?.githubUrl, skill.githubUrl);
    assert.deepEqual(cached, first);
    await service.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("previews an exact GitHub commit and installs the reviewed directory with origin metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wordless-skillsmp-"));
  const rawSkillUrl = `https://raw.githubusercontent.com/example/skills/${commitSha}/skills/productivity/SKILL.md`;
  const rawScriptUrl = `https://raw.githubusercontent.com/example/skills/${commitSha}/skills/productivity/scripts/run.js`;
  const skillApiUrl = `https://api.github.com/repos/example/skills/contents/skills/productivity/SKILL.md?ref=${commitSha}`;
  const scriptApiUrl = `https://api.github.com/repos/example/skills/contents/skills/productivity/scripts/run.js?ref=${commitSha}`;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://market.example/search")) return searchResponse();
    if (url.includes("/commits/main")) return new Response(JSON.stringify({ sha: commitSha }), { status: 200 });
    if (url.includes("/contents/skills/productivity/scripts?")) return new Response(JSON.stringify([
      { type: "file", path: "skills/productivity/scripts/run.js", size: Buffer.byteLength("console.log('run');"), download_url: rawScriptUrl, url: scriptApiUrl },
    ]), { status: 200 });
    if (url.includes("/contents/skills/productivity?")) return new Response(JSON.stringify([
      { type: "file", path: "skills/productivity/SKILL.md", size: Buffer.byteLength(skillMarkdown), download_url: rawSkillUrl, url: skillApiUrl },
      { type: "dir", path: "skills/productivity/scripts", size: 0, download_url: null },
    ]), { status: 200 });
    if (url === rawSkillUrl) return new Response(skillMarkdown, { status: 200 });
    if (url === rawScriptUrl) return new Response("console.log('run');", { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const service = new SkillsMpMarketplaceService(root, { endpoint: "https://market.example/search", fetch: fetchImpl });
    await service.search("productivity");
    const preview = await service.preview(skill.id);
    assert.equal(preview.commitSha, commitSha);
    assert.deepEqual(preview.files.map((file) => file.path), ["scripts/run.js", "SKILL.md"]);
    assert.equal(preview.skillMarkdown, skillMarkdown);
    let importedRoot = "";
    const origin = await service.install(preview.previewId, async (directory) => {
      importedRoot = directory;
      assert.equal(await readFile(path.join(directory, "SKILL.md"), "utf8"), skillMarkdown);
      const metadata = JSON.parse(await readFile(path.join(directory, ".wordless-marketplace.json"), "utf8")) as { id: string; commitSha: string };
      assert.equal(metadata.id, skill.id);
      assert.equal(metadata.commitSha, commitSha);
    });
    assert.equal(origin.id, skill.id);
    await assert.rejects(readFile(path.join(importedRoot, "SKILL.md"), "utf8"));
    await service.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects download URLs that do not pin the reviewed repository and commit", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wordless-skillsmp-"));
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://market.example/search")) return searchResponse();
    if (url.includes("/commits/main")) return new Response(JSON.stringify({ sha: commitSha }), { status: 200 });
    if (url.includes("/contents/skills/productivity?")) return new Response(JSON.stringify([
      { type: "file", path: "skills/productivity/SKILL.md", size: 10, download_url: "https://evil.example/SKILL.md", url: `https://api.github.com/repos/example/skills/contents/skills/productivity/SKILL.md?ref=${commitSha}` },
    ]), { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const service = new SkillsMpMarketplaceService(root, { endpoint: "https://market.example/search", fetch: fetchImpl });
    await service.search("productivity");
    await assert.rejects(service.preview(skill.id), /untrusted skill download URL/);
    await service.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
