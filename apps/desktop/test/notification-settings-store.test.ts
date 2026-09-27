import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_NOTIFICATION_DEFAULTS,
  defaultNotificationDefaultsPath,
  loadNotificationDefaults,
  saveNotificationDefaults,
} from "../src/main/notifications/settings-store.ts";

/**
 * The global push defaults file.
 *
 * Every read path must produce something usable: this file decides whether a run
 * that finishes at 3am tells anyone, and a parse error must not be able to turn that
 * into an exception in the automation service.
 */
async function tempFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "wordless-notify-"));
  // Some cases write the file by hand without going through save, which is what
  // creates this directory in production.
  await mkdir(path.join(dir, "notifications"), { recursive: true });
  return defaultNotificationDefaultsPath(dir);
}

test("a missing file means push is off", async () => {
  assert.deepEqual(await loadNotificationDefaults(await tempFile()), DEFAULT_NOTIFICATION_DEFAULTS);
  // Off is the default on purpose: a notification the user did not ask for is worse
  // than one they miss, and push is a visible act in a shared group.
  assert.equal(DEFAULT_NOTIFICATION_DEFAULTS.enabled, false);
});

test("a corrupt file degrades rather than throwing", async () => {
  const file = await tempFile();
  await saveNotificationDefaults(file, DEFAULT_NOTIFICATION_DEFAULTS);
  await writeFile(file, "{ not json", "utf8");
  assert.deepEqual(await loadNotificationDefaults(file), DEFAULT_NOTIFICATION_DEFAULTS);

  await writeFile(file, JSON.stringify([1, 2, 3]), "utf8");
  assert.deepEqual(await loadNotificationDefaults(file), DEFAULT_NOTIFICATION_DEFAULTS);
});

test("a stored file round-trips", async () => {
  const file = await tempFile();
  const defaults = { enabled: true, endpointIds: ["e1", "e2"], when: "failure" as const, template: "{{status}}" };
  await saveNotificationDefaults(file, defaults);
  assert.deepEqual(await loadNotificationDefaults(file), defaults);
});

test("field-level damage is repaired without losing the rest", async () => {
  const file = await tempFile();
  await writeFile(
    file,
    JSON.stringify({
      enabled: "yes",
      endpointIds: ["e1", 42, "", null, "e2"],
      when: "sometimes",
      template: "   ",
    }),
    "utf8",
  );
  const loaded = await loadNotificationDefaults(file);
  assert.equal(loaded.enabled, true);
  // Junk ids are dropped: an id that is not a string, or is empty, names nothing.
  assert.deepEqual(loaded.endpointIds, ["e1", "e2"]);
  // An unrecognised mode falls back rather than producing a status filter that never
  // matches anything.
  assert.equal(loaded.when, "always");
  // A blank template means "use the built-in one", not an empty message.
  assert.equal(loaded.template, undefined);
});

test("saving leaves no temporary file behind", async () => {
  const file = await tempFile();
  await saveNotificationDefaults(file, DEFAULT_NOTIFICATION_DEFAULTS);
  const raw = await readFile(file, "utf8");
  assert.match(raw, /"enabled": false/);
  await assert.rejects(async () => await readFile(`${file}.tmp`, "utf8"));
});
