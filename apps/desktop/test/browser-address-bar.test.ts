import assert from "node:assert/strict";
import test from "node:test";
import { formatAddressBarValue } from "../src/renderer/features/browser/address-bar.ts";

test("formats the address bar without a bare trailing slash", () => {
  assert.equal(formatAddressBarValue("http://localhost:3000/"), "localhost:3000");
  assert.equal(formatAddressBarValue("https://example.com/docs"), "example.com/docs");
  assert.equal(formatAddressBarValue("https://example.com/docs?q=1#top"), "example.com/docs?q=1#top");
});

test("shows an empty address bar for the blank page", () => {
  assert.equal(formatAddressBarValue(""), "");
  assert.equal(formatAddressBarValue("about:blank"), "");
});

test("falls back to the raw value when a url cannot be parsed", () => {
  assert.equal(formatAddressBarValue("not a url"), "not a url");
});
