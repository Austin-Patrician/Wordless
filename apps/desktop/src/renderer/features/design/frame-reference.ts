import type { DesignFrameDto } from "@wordless/protocol";
import type { InlineWorkspaceReferenceToken } from "../thread/InlineSkillComposer";

/**
 * 把画布上的一帧变成对话里的一个引用。
 *
 * ## 为什么复用 `wordless_workspace_reference`
 *
 * 那条通道本来就在:工作区里的文件能被拖进输入框、变成一条引用,agent 收到的是带路径的
 * 引用块。而**帧就是文件**(`frames/login.html`)—— 所以"引用这一帧"与"引用这个文件"是同一
 * 件事,不该另立一种引用类型。少一种类型,就少一处两个地方各自解释、然后漂开的机会。
 *
 * ## 路径必须是**工作区相对**的
 *
 * agent 的文件工具以工作区根为基准,而画布手上的路径是绝对的。两边用不同的基准时,引用看起
 * 来一样而 agent 读不到 —— 所以换算在纯函数里做,并且**取不出来时宁可返回 null**(不在工作
 * 区内的设计包),由调用方决定怎么告诉用户,而不是给一个 agent 打不开的路径。
 *
 * 本文件不 import React。
 */

/** 归一化:统一分隔符、去尾斜杠。 */
function normalize(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

/**
 * 绝对路径 → 工作区相对路径。不在工作区内时返回 `null`。
 *
 * 比的时候带上分隔符,免得 `/w/designs-alpha` 被当成 `/w/designs` 的子路径。
 */
export function workspaceRelativePath(absolute: string, root: string | null): string | null {
  // `root` 收 null 而不是让每个调用方各判一次:没有工作区的会话(设计包在会话私有根里)
  // 是一个真实状态,而"基准不存在"就意味着换算不出来 —— 那是同一件事,只该说一遍。
  if (root === null) return null;
  const target = normalize(absolute);
  const base = normalize(root);
  if (base === "" || target === "") return null;
  if (target === base) return "";
  return target.startsWith(`${base}/`) ? target.slice(base.length + 1) : null;
}

/**
 * 一帧的引用。
 *
 * `name` 用**帧标题**而不是文件名:它在输入框里给人看,而标题正是画布上那块画板的标签;
 * 路径才是给 agent 的。
 */
export function frameReference(input: {
  designPath: string;
  frame: DesignFrameDto;
  workspaceRoot: string | null;
}): InlineWorkspaceReferenceToken | null {
  const { designPath, frame, workspaceRoot } = input;
  if (workspaceRoot === null) return null;
  const relative = workspaceRelativePath(`${normalize(designPath)}/${frame.file}`, workspaceRoot);
  if (relative === null || relative === "") return null;
  return { kind: "file", name: frame.title, path: relative };
}
