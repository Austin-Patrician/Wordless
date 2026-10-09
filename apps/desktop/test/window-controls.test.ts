import assert from "node:assert/strict";
import test from "node:test";
import { windowControls } from "../src/renderer/features/workbench/window-controls.ts";

/**
 * 自绘窗口按钮的"画哪一个、自报什么"。
 *
 * 这些按钮**只有 Linux 上会画**(其他平台是系统画的),所以它们错了不会有人替我们兜底:
 * 图标与标签必须跟着窗口状态变,而这件事没有浏览器也能测 —— 判断本身是纯函数。
 */

test("the middle window control flips between maximize and restore", () => {
  const normal = windowControls(false);
  const maximized = windowControls(true);

  assert.deepEqual(normal[1], { action: "toggle-maximize", icon: "maximize", label: "Maximize" });
  assert.deepEqual(maximized[1], { action: "toggle-maximize", icon: "restore", label: "Restore" });
  // **动作不变**:变的是图标与标签,点击语义始终是"切换"。写反了(比如最大化时发 maximize)
  // 会让按钮点一下就"没反应"(已经最大化了)。
  assert.deepEqual(maximized.map((control) => control.action), normal.map((control) => control.action));
});

test("every control has an accessible label and the order is minimize / maximize / close", () => {
  const controls = windowControls(false);

  assert.deepEqual(controls.map((control) => control.action), ["minimize", "toggle-maximize", "close"]);
  for (const control of controls) {
    assert.ok(control.label.trim().length > 0, `${control.action} 没有标签`);
  }
  // 三个标签必须互不相同:否则读屏用户听到三个一样的按钮。
  assert.equal(new Set(controls.map((control) => control.label)).size, controls.length);
});
