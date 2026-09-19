import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OnboardingService, ONBOARDING_VERSION } from "../src/main/onboarding/onboarding-service.ts";

async function withService(run: (service: OnboardingService, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "wordless-onboarding-"));
  try {
    await run(new OnboardingService(directory), directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test("a fresh installation has not completed the guide", async () => {
  await withService(async (service) => {
    assert.deepEqual(await service.read(), { version: ONBOARDING_VERSION, completedAt: null });
  });
});

test("completing the guide persists a timestamp the host can read back", async () => {
  await withService(async (service, directory) => {
    const before = Date.now();
    const completed = await service.complete();
    assert.equal(completed.version, ONBOARDING_VERSION);
    assert.ok(completed.completedAt !== null && completed.completedAt >= before);

    // A second service over the same directory simulates the next launch.
    const reopened = await new OnboardingService(directory).read();
    assert.equal(reopened.completedAt, completed.completedAt);
  });
});

test("resetting makes the guide available again", async () => {
  await withService(async (service) => {
    await service.complete();
    assert.deepEqual(await service.reset(), { version: ONBOARDING_VERSION, completedAt: null });
    assert.equal((await service.read()).completedAt, null);
  });
});

test("a record from an older guide revision is treated as incomplete", async () => {
  await withService(async (service, directory) => {
    await writeFile(join(directory, "onboarding.json"), JSON.stringify({ version: ONBOARDING_VERSION - 1, completedAt: 1 }), "utf8");
    assert.equal((await service.read()).completedAt, null);
  });
});

test("a corrupt record does not throw and is repaired on completion", async () => {
  await withService(async (service, directory) => {
    const statePath = join(directory, "onboarding.json");
    await writeFile(statePath, "{ not json", "utf8");
    assert.deepEqual(await service.read(), { version: ONBOARDING_VERSION, completedAt: null });

    await service.complete();
    assert.ok(JSON.parse(await readFile(statePath, "utf8")).completedAt !== null);
  });
});
