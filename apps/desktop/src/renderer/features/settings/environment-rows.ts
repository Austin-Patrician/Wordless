import type { HostEnvironmentFacts } from "@wordless/protocol";
import type { MessageKey } from "../../shared/i18n";

/**
 * 把宿主环境事实翻成"面板要显示的三行"。
 *
 * 抽成纯函数是为了让它可测(不必起 React),而且**只有这一处**决定"什么算可用":面板、导览、欢迎页
 * 里的那句状态都读它。三行的顺序 shell → node → python 也是固定的:从"agent 能不能跑命令"到
 * "能不能跑脚本",由基础到具体。
 */
export type EnvironmentRowStatus = "ok" | "partial" | "missing";

export interface EnvironmentRow {
  id: "shell" | "node" | "python";
  labelKey: MessageKey;
  status: EnvironmentRowStatus;
  /** 版本号单独成列(等宽显示,三个运行时纵向对齐 —— 版本是最常被拿来比较的东西)。 */
  version?: string;
  /**
   * 来源/状态的一句话("系统安装的"、"Wordless 自带的(没有 npm)")。
   *
   * **命令行那一行没有**:它不需要说明来源 —— 每台机器都有命令行,那是通用的东西。
   */
  detail?: string;
  /** 可执行文件位置(单独一行显示,等宽)。没有就不显示。 */
  location?: string;
  /** 缺失或部分可用时:这对用户意味着什么。 */
  hint?: string;
  /**
   * 缺失时的出路。面板只给入口,绝不自动跑:
   * - `python-download`:连内置那份都没有(打包时跳过/被破坏)→ 只能引导用户装 Python;
   * - `install-python-packages`:Python 有、缺第三方包 → 用户点一次,装进**内置那份**。
   */
  action?: "python-download" | "install-python-packages";
}

export function hostEnvironmentRows(
  facts: HostEnvironmentFacts,
  t: (key: MessageKey) => string,
): EnvironmentRow[] {
  // 命令行**不展示实现细节**:跑的是 bash 还是 PowerShell、装在哪个路径,都是通用且与用户无关的东西
  // (在 Windows 上把 "bash" 摆出来只会让人以为缺了什么)。状态芯片说"可用"就够了。
  const shell: EnvironmentRow = facts.shell
    ? {
        id: "shell",
        labelKey: "environmentShell",
        status: "ok",
      }
    : {
        id: "shell",
        labelKey: "environmentShell",
        status: "missing",
        detail: t("environmentMissing"),
        hint: t("environmentShellMissing"),
      };

  const node: EnvironmentRow = !facts.node.found
    ? {
        id: "node",
        labelKey: "environmentNode",
        status: "missing",
        detail: t("environmentMissing"),
        hint: t("environmentNodeMissing"),
      }
    : {
        id: "node",
        labelKey: "environmentNode",
        status: "ok",
        version: `v${facts.node.version ?? "?"}`,
        // 自带那份必须写明"没有 npm":那正是它和用户自己装的那份最实际的差别。
        detail: facts.node.source === "wordless" ? t("environmentNodeWordless") : t("environmentNodeSystem"),
      };

  const missingPackages = (Object.entries(facts.python.packages) as [string, boolean][])
    .filter(([, present]) => !present)
    .map(([name]) => name);
  const python: EnvironmentRow = !facts.python.found
    ? {
        id: "python",
        labelKey: "environmentPython",
        status: "missing",
        detail: t("environmentMissing"),
        hint: t("environmentPythonMissing"),
        action: "python-download",
      }
    : {
        id: "python",
        labelKey: "environmentPython",
        // **有 python ≠ 有 pandas**:数据功能要的是依赖齐全的那个运行时,所以这里要分开说。
        status: missingPackages.length > 0 ? "partial" : "ok",
        version: `Python ${facts.python.version ?? "?"}`,
        // 内置那份要标出来:用户照着"没有 Python 也能用"去理解时,得知道跑的是哪一个。
        detail: facts.python.source === "wordless" ? t("environmentPythonWordless") : t("environmentNodeSystem"),
        location: facts.python.executable,
        ...(missingPackages.length > 0
          ? {
              hint: t("environmentPythonPackages").replace("{packages}", missingPackages.join(", ")),
              action: "install-python-packages" as const,
            }
          : {}),
      };

  return [shell, node, python];
}
