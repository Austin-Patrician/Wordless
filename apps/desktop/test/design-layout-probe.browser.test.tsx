import { describe, expect, it } from "vitest";
import { LAYOUT_PROBE_EXPRESSION } from "../../../packages/capabilities/design/src/probe-script.ts";

/**
 * 布局探针必须跑在**真浏览器**里:它量的全是 `getBoundingClientRect` / `scrollHeight` 这类
 * 只有真正排版过才有意义的值,jsdom 上量出来全是 0。
 *
 * 这个文件的存在理由是一条真实故障:探针曾经连报 17 次同一条
 * `[overflow-y] … content is 4px taller than its box`,而那不是缺陷 —— agent 修不掉,
 * 又被告知"修完再截图",于是整个会话卡了 62 分钟。
 */

interface Finding {
  kind: string;
  selector: string;
  detail: string;
}

function probe(html: string): Finding[] {
  document.body.innerHTML = html;
  // 表达式是自包含的 IIFE,末尾 `return findings`。
  return eval(LAYOUT_PROBE_EXPRESSION) as Finding[];
}

function kinds(html: string): string[] {
  return probe(html).map((finding) => finding.kind);
}

describe("layout probe", () => {
  it("says nothing about content that is a few pixels taller when nothing is clipped", () => {
    // 手机帧的 body 比声明高度多几像素完全正常 —— 可滚动的区域超出是正常的。
    const reported = kinds(
      '<div style="width:200px;height:80px"><div style="width:200px;height:84px"></div></div>',
    );

    expect(reported).not.toContain("overflow-y");
    expect(reported).not.toContain("overflow-x");
  });

  it("still reports content that is actually cut off", () => {
    // 裁剪了、又没有省略号 —— 那就是硬切掉,用户真的看不全。
    const reported = kinds(
      '<div style="width:120px;height:40px;overflow:hidden;white-space:nowrap">a line of text far too long to fit here</div>',
    );

    expect(reported).toContain("text-clipped");
  });

  it("still reports a row item wider than the row itself", () => {
    const reported = kinds(
      // `flex-shrink: 0`:不加的话这个子项会被压回 100px —— 那本来就不算溢出,测的就不是这条规则了。
      '<div style="display:flex;flex-direction:row;width:100px"><div style="width:140px;height:20px;flex-shrink:0"></div></div>',
    );

    expect(reported).toContain("flex-item-overflow");
  });

  it("reports nothing for a tidy frame", () => {
    // 没有假阳性是这套检查能用的前提:一条修不掉的报告就能让 agent 打转。
    const reported = kinds(
      '<div style="width:390px;height:844px"><p style="margin:0">Home</p><div style="width:100px;height:20px"></div></div>',
    );

    expect(reported).toEqual([]);
  });
});
