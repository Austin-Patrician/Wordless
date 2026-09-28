/**
 * 「角色模型」下拉框要显示什么。
 *
 * **抽出来的理由是一次真实的踩坑**:下拉框的选项只来自**当前启用的模型**,而 `value` 是
 * 存下来的引用。当那个引用已经不在了(连接被删掉/改名),HTML 里 `value` 匹配不到任何
 * `<option>` —— 浏览器就把它显示成**空白**。用户看到的是一个空的下拉框,读作"没配过,
 * 所以继承会话模型";而运行时仍然按存下来的那个引用走,于是 `delegate_task` 报出
 * "The selected model is not enabled"。
 *
 * **控件不能与它背后的状态不一致。** 存着的引用选不到时,就把它自己作为一条「不可用」的
 * 选项显示出来 —— 用户才看得见、也才清得掉。
 *
 * 本文件不 import React。
 */

export interface RoleModelChoice {
  value: string;
  label: string;
  /** 存下来的引用当前选不到 —— 显示要标出来,并提示去改。 */
  unavailable: boolean;
}

export interface RoleModelSelect {
  /** 交给 `<select value>`。空串表示"继承会话模型"。 */
  value: string;
  options: readonly RoleModelChoice[];
}

export function roleModelSelect(input: {
  /** 存下来的引用,`connectionId/modelId`;`null` 表示继承会话模型。 */
  stored: string | null;
  /** 当前启用、可选的那些模型。 */
  enabled: readonly { value: string; label: string }[];
}): RoleModelSelect {
  const options: RoleModelChoice[] = input.enabled.map((model) => ({ ...model, unavailable: false }));
  const stored = input.stored;

  if (stored !== null && stored !== "" && !options.some((option) => option.value === stored)) {
    // 放最前面:它是当前生效的那条,不该埋在列表里。
    options.unshift({ value: stored, label: stored, unavailable: true });
  }

  return { value: stored ?? "", options };
}

/**
 * 从扩展设置里读出某个角色存下来的引用。
 *
 * 形状不对就当"没配" —— 但形状对、指向的东西不在了,必须照原样读出来(见上面的理由:
 * 那正是控件要说真话的那种情形)。
 */
export function storedRoleModel(settings: unknown, roleId: string): string | null {
  if (typeof settings !== "object" || settings === null) return null;
  const roleModels = (settings as { roleModels?: unknown }).roleModels;
  if (typeof roleModels !== "object" || roleModels === null || Array.isArray(roleModels)) return null;
  const entry = (roleModels as Record<string, unknown>)[roleId];
  if (typeof entry !== "object" || entry === null) return null;
  const { connectionId, modelId } = entry as { connectionId?: unknown; modelId?: unknown };
  if (typeof connectionId !== "string" || typeof modelId !== "string" || connectionId === "" || modelId === "") return null;
  return `${connectionId}/${modelId}`;
}
