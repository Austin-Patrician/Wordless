import assert from "node:assert/strict";
import test from "node:test";
import {
  BoundedIdCache,
  ThreadProjectionPublisher,
} from "../src/renderer/features/thread/thread-projection-core.ts";

test("bounded event ids keep constant capacity without changing membership semantics", () => {
  const ids = new BoundedIdCache(20_000);
  for (let index = 0; index < 100_000; index += 1)
    ids.add(`event-${index}`);

  assert.equal(ids.size, 20_000);
  assert.equal(ids.has("event-79999"), false);
  assert.equal(ids.has("event-80000"), true);
  assert.equal(ids.has("event-99999"), true);
  ids.clear();
  assert.equal(ids.size, 0);
});

test("projection transactions publish structure, tail, rows, metadata, and history once in order", () => {
  const publisher = new ThreadProjectionPublisher();
  const notifications: string[] = [];
  publisher.subscribe("timeline", () => notifications.push("timeline"));
  publisher.subscribe("tail-growth", () => notifications.push("tail"));
  publisher.subscribeRow("assistant:turn", () => notifications.push("row"));
  publisher.subscribe("metadata", () => notifications.push("metadata"));
  publisher.subscribe("history", () => notifications.push("history"));

  publisher.transaction(() => {
    publisher.publish("metadata");
    publisher.publishRow("assistant:turn");
    publisher.publishRow("assistant:turn");
    publisher.publish("history");
    publisher.publish("tail-growth");
    publisher.publish("timeline");
  });

  assert.deepEqual(notifications, ["timeline", "tail", "row", "metadata", "history"]);
  publisher.dispose();
});
