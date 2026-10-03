import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ACCESS_OPTIONS,
	APPROVAL_OPTIONS,
	COMPOSER_MORE_ENTRIES,
	composerControls,
	connectorRows,
	permissionLabel,
} from "../src/composer-controls.ts";

/**
 * 输入区那一行控件:显示什么、哪些能改。
 *
 * 这一层守的是**别骗人**:能改的只有模型;权限与连接器必须显示当前值,而且**不能**长成"可以点开关"的样子。
 */

const session = (overrides: Record<string, unknown> = {}) => ({
	id: "s1",
	title: "t",
	updatedAt: 1,
	running: false,
	...overrides,
});

describe("控件行", () => {
	it("四个控件都在,顺序与桌面端一致(权限 / 连接器 / 模型 / 更多)", () => {
		const controls = composerControls({ session: session() as never, models: undefined, running: false });
		assert.deepEqual(
			controls.map((control) => control.kind),
			["permissions", "connectors", "model", "more"],
		);
	});

	it("模型、权限、连接器都能改;「更多」只是说明", () => {
		const controls = composerControls({
			session: session() as never,
			models: [{ connectionId: "c", modelId: "m", displayName: "M" }],
			running: false,
		});
		assert.deepEqual(
			controls.map((control) => control.editable),
			[true, true, true, false],
		);
	});

	it("正在回复时三个都关掉(本机会拒绝,界面先如实关掉)", () => {
		const controls = composerControls({
			session: session() as never,
			models: [{ connectionId: "c", modelId: "m", displayName: "M" }],
			running: true,
		});
		assert.deepEqual(
			controls.map((control) => control.editable),
			[false, false, false, false],
		);
	});

	it("正在回复时模型也关掉(本机会拒绝,界面先如实关掉)", () => {
		const controls = composerControls({
			session: session() as never,
			models: [{ connectionId: "c", modelId: "m", displayName: "M" }],
			running: true,
		});
		assert.equal(controls.find((control) => control.kind === "model")?.editable, false);
	});

	it("没有模型清单时也关掉(这台机器不支持远端换模型)", () => {
		const controls = composerControls({ session: session() as never, models: [], running: false });
		assert.equal(controls.find((control) => control.kind === "model")?.editable, false);
	});

	it("按钮上的值:模型名、连接器数量、权限说法", () => {
		const controls = composerControls({
			session: session({
				modelName: "Claude Sonnet 4",
				toolApprovalMode: "manual",
				connectors: [{ id: "k1", name: "GitHub", enabled: true }],
			}) as never,
			models: undefined,
			running: false,
		});
		assert.equal(controls.find((control) => control.kind === "model")?.value, "Claude Sonnet 4");
		assert.equal(controls.find((control) => control.kind === "connectors")?.value, "1");
		assert.equal(controls.find((control) => control.kind === "permissions")?.value, "手动确认");
	});
});

describe("权限说法", () => {
	it("工具确认优先(它更常影响用户的判断)", () => {
		assert.equal(permissionLabel(session({ accessLevel: "full", toolApprovalMode: "manual" }) as never), "手动确认");
	});

	it("没有工具确认就说访问权限", () => {
		assert.equal(permissionLabel(session({ accessLevel: "full" }) as never), "完全访问");
	});

	it("都没有就不编", () => {
		assert.equal(permissionLabel(session() as never), undefined);
		assert.equal(permissionLabel(undefined), undefined);
	});
});

describe("连接器行", () => {
	it("只给名字与开关状态", () => {
		assert.deepEqual(connectorRows([{ id: "k1", name: "GitHub", enabled: true }]), [
			{ id: "k1", name: "GitHub", enabled: true },
		]);
	});

	it("没有连接器时是空数组,不是 undefined", () => {
		assert.deepEqual(connectorRows(undefined), []);
	});
});

describe("「+」里有什么", () => {
	it("每一项都写清为什么不能 —— 藏起来比说清楚更糟", () => {
		for (const entry of COMPOSER_MORE_ENTRIES) {
			assert.equal(entry.available, false);
			assert.ok((entry.hint ?? "").length > 0, `${entry.label} 应当有说明`);
		}
	});

describe("可选值", () => {
	it("权限的可选值就是协议白名单那几档(不多不少)", () => {
		assert.deepEqual(
			ACCESS_OPTIONS.map((option) => option.value),
			["default", "full"],
		);
		// 与桌面端同样的全量选择:三档都给。
		assert.deepEqual(
			APPROVAL_OPTIONS.map((option) => option.value),
			["manual", "auto", "bypass"],
		);
	});
});
});
