import assert from "node:assert/strict";
import test from "node:test";
import {
  findShortcutConflict,
  type ShortcutActionId,
  getEffectiveShortcut,
  isBindableShortcut,
  listShortcutBindings,
  normalizeShortcutBindings,
  SHORTCUT_ACTIONS,
} from "@wordless/domain";

test("the action table stays internally consistent", () => {
  const ids = SHORTCUT_ACTIONS.map((action) => action.id);
  assert.equal(new Set(ids).size, ids.length, "two actions share an id");

  // Two actions shipping on one key would make dispatch depend on table order.
  const defaults = SHORTCUT_ACTIONS.map((action) => action.defaultShortcut);
  assert.equal(new Set(defaults).size, defaults.length, "two actions share a default key");

  // A default has to survive the normalizer, otherwise clearing a binding could
  // not return the action to it.
  for (const action of SHORTCUT_ACTIONS) {
    assert.deepEqual(normalizeShortcutBindings({ [action.id]: action.defaultShortcut }), {}, action.id);
  }
});

test("a stored binding is kept, in its canonical spelling", () => {
  assert.deepEqual(normalizeShortcutBindings({ "open-settings": "Shift+Mod+," }), { "open-settings": "mod+shift+," });
  assert.deepEqual(normalizeShortcutBindings({ "open-settings": " mod + , " }), {});
  assert.deepEqual(
    normalizeShortcutBindings({ "new-thread": "mod+alt+j", "open-settings": "mod+shift+," }),
    { "new-thread": "mod+alt+j", "open-settings": "mod+shift+," },
  );
});

test("bindings the interface cannot honour are dropped", () => {
  // An action this build does not know: a table from another version, or a typo.
  assert.deepEqual(normalizeShortcutBindings({ "removed-action": "mod+j" }), {});
  // A modifier with no key, a repeated modifier, a non-modifier in front of one.
  assert.deepEqual(normalizeShortcutBindings({ "open-settings": "mod+" }), {});
  assert.deepEqual(normalizeShortcutBindings({ "open-settings": "mod+mod+," }), {});
  assert.deepEqual(normalizeShortcutBindings({ "open-settings": "ctrl+mod+shift+," }), { "open-settings": "mod+ctrl+shift+," });
  assert.deepEqual(normalizeShortcutBindings({ "open-settings": "meta+," }), {});
  // A modifier pressed on its own is not a shortcut.
  assert.deepEqual(normalizeShortcutBindings({ "open-settings": "shift" }), {});
  // Not a binding set at all.
  assert.deepEqual(normalizeShortcutBindings("mod+,"), {});
  assert.deepEqual(normalizeShortcutBindings(null), {});
  assert.deepEqual(normalizeShortcutBindings(["mod+,"]), {});
  assert.deepEqual(normalizeShortcutBindings({ "open-settings": 7 }), {});
});

test("an action keeps its default until a binding replaces it", () => {
  assert.equal(getEffectiveShortcut("open-settings"), "mod+,");
  assert.equal(getEffectiveShortcut("open-settings", {}), "mod+,");
  assert.equal(getEffectiveShortcut("new-thread", {}), "mod+n");
  assert.equal(getEffectiveShortcut("open-settings", { "open-settings": "mod+shift+," }), "mod+shift+,");
  // One action's binding never leaks into another.
  assert.equal(getEffectiveShortcut("new-thread", { "open-settings": "mod+j" }), "mod+n");
});

test("a binding needs a holding modifier, so ordinary typing survives", () => {
  // A bare or Shift-only key would fire while the user types anywhere in the app.
  assert.equal(isBindableShortcut("mod+n"), true);
  assert.equal(isBindableShortcut("mod+shift+,"), true);
  assert.equal(isBindableShortcut("alt+n"), true);
  assert.equal(isBindableShortcut("n"), false);
  assert.equal(isBindableShortcut("shift+n"), false);
  assert.equal(isBindableShortcut("mod+"), false);
  // ...and such a value can never be stored, however it arrives.
  assert.deepEqual(normalizeShortcutBindings({ "new-thread": "shift+n", "open-settings": "j" }), {});
});

test("a conflict is reported against the action that holds the key, defaults included", () => {
  // An action without a binding still holds its default, so it can be in the way.
  assert.equal(findShortcutConflict("new-thread", "mod+,", {}), "open-settings");
  assert.equal(findShortcutConflict("open-settings", "mod+n", {}), "new-thread");
  assert.equal(findShortcutConflict("open-settings", "mod+alt+q", {}), null);
  // An action is never in conflict with itself, even on its own key.
  assert.equal(findShortcutConflict("open-settings", "mod+,", {}), null);
  // Once the other action moved away, the key is free.
  assert.equal(findShortcutConflict("new-thread", "mod+,", { "open-settings": "mod+alt+q" }), null);
  assert.equal(findShortcutConflict("open-settings", "mod+alt+q", { "open-settings": "mod+alt+q" }), null);
  // Every action the table ships with is in the way of the others.
  assert.equal(findShortcutConflict("open-settings", "mod+4", {}), "open-tasks");
  // A malformed candidate is not a conflict, only invalid.
  assert.equal(findShortcutConflict("new-thread", "mod+", {}), null);
});

test("the listed bindings say which ones are still default", () => {
  const rows = listShortcutBindings({ "open-settings": "mod+shift+," });
  // One row per action and in table order: a new action cannot be forgotten in
  // the settings page without failing here.
  assert.deepEqual(rows.map((row) => row.id), SHORTCUT_ACTIONS.map((action) => action.id));
  assert.deepEqual(rows.find((row) => row.id === "open-settings"), {
    id: "open-settings",
    shortcut: "mod+shift+,",
    defaultShortcut: "mod+,",
    isDefault: false,
  });
  assert.deepEqual(rows.filter((row) => !row.isDefault).map((row) => row.id), ["open-settings"]);
  assert.deepEqual(listShortcutBindings().filter((row) => !row.isDefault), []);
});

test("the view shortcuts follow the order of the sidebar", () => {
  // Conversation first, then the views as the sidebar lists them, so the digits
  // can be pressed from memory.
  const viewIds = ["open-conversation", "open-media", "open-automation", "open-tasks", "open-experts", "open-skills"] as const satisfies readonly ShortcutActionId[];
  assert.deepEqual(viewIds.map((id) => getEffectiveShortcut(id)), ["mod+1", "mod+2", "mod+3", "mod+4", "mod+5", "mod+6"]);
});

test("no default takes a key the interface already uses for something else", () => {
  // Media copy/paste and the composer's send chord are handled where they are
  // used; a global default must not shadow them.
  const handledLocally = ["mod+c", "mod+v", "mod+enter"];
  for (const action of SHORTCUT_ACTIONS) {
    assert.equal(handledLocally.includes(action.defaultShortcut), false, action.id);
  }
});
