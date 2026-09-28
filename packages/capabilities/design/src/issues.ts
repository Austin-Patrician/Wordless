/**
 * 设计包的问题模型。
 *
 * 这是质检闭环里**确定性**的那一半:模型看像素(screenshot)之前,先用规则把"一定有问题"
 * 的地方列出来。两者缺一不可 —— 规则的可靠性换不来"看起来对不对",而模型的眼睛换不来
 * 可复现。
 *
 * 纯函数,不 import React、不 import Electron、不 import 宿主。
 */

export type DesignIssueCode =
  /** 帧文件里没有 `@frame` 声明(尺寸靠兜底)。 */
  | "frame-size-missing"
  /** 帧标题只是文件名 —— 画布上的标签没有意义。 */
  | "frame-title-generic"
  /** 整份设计一帧都没有。 */
  | "no-frames"
  /** 没有应用任何风格,于是没有令牌可用。 */
  | "style-not-applied"
  /** 应用了风格但 `DESIGN.md` 不在,写下来的规则读不到。 */
  | "design-doc-missing"
  /** 帧文件在磁盘上不存在(清单指向一个已经删掉的文件)。 */
  | "frame-file-missing"
  /** 布局探针报的溢出。 */
  | "layout-overflow"
  /** 布局探针报的文本被裁。 */
  | "layout-text-clipped"
  /** 布局探针报的形状问题(换行、flex 溢出、背景被裁)。 */
  | "layout-shape";

export interface DesignIssue {
  code: DesignIssueCode;
  /** 属于哪一帧;整份设计级的问题为 null。 */
  frameId: string | null;
  /** 一句话,直接给模型看。 */
  message: string;
}

export interface FrameFacts {
  id: string;
  title: string;
  file: string;
  /** 帧源码里有没有 `@frame` 声明。 */
  declaredSize: boolean;
  /** 文件是否真的在磁盘上。 */
  fileExists: boolean;
}

export interface DesignFacts {
  path: string;
  name: string;
  mode: "static" | "built";
  /** 当前应用的风格 id。 */
  style: string | null;
  /** 参考目录里有没有 `DESIGN.md`。 */
  hasDesignDoc: boolean;
  frames: readonly FrameFacts[];
}

/**
 * 从事实推出问题。
 *
 * 顺序即输出的顺序:先整份设计级,再逐帧 —— 让模型先看到"这份设计整体怎么了",而不是
 * 淹在一堆逐帧细节里。
 */
export function designIssues(facts: DesignFacts): DesignIssue[] {
  const issues: DesignIssue[] = [];

  if (facts.frames.length === 0) {
    issues.push({
      code: "no-frames",
      frameId: null,
      message: "This design has no frames yet. Add at least one HTML file under frames/.",
    });
  }

  if (facts.style === null) {
    issues.push({
      code: "style-not-applied",
      frameId: null,
      message: "No style is applied. Read theme.css and use only the tokens it defines.",
    });
  } else if (!facts.hasDesignDoc) {
    issues.push({
      code: "design-doc-missing",
      frameId: null,
      message: `Style "${facts.style}" is applied but DESIGN.md is missing, so the written rules are not available.`,
    });
  }

  for (const frame of facts.frames) {
    if (!frame.fileExists) {
      issues.push({
        code: "frame-file-missing",
        frameId: frame.id,
        message: `${frame.file} is listed in the manifest but not on disk.`,
      });
      continue;
    }
    if (!frame.declaredSize) {
      // 帧仍然上画布(拿多数派尺寸),问题在这里报出去 —— 渲染和报错是两件事。
      issues.push({
        code: "frame-size-missing",
        frameId: frame.id,
        message: `frames/${frame.id}.html has no @frame declaration, so its size falls back to another frame's. Add one.`,
      });
    }
    if (frame.title === frame.id) {
      issues.push({
        code: "frame-title-generic",
        frameId: frame.id,
        message: `The frame's title is just its file name, so the canvas label says nothing. Give it a real title.`,
      });
    }
  }

  return issues;
}

/** 有没有会拦住"完成"的问题。用于工具输出里的结论行。 */
export function isBlocking(issue: DesignIssue): boolean {
  return issue.code === "no-frames" || issue.code === "frame-file-missing";
}
