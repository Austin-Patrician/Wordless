import type { HostEnvironmentFacts } from "@wordless/protocol";
import type { MessageKey } from "../../shared/i18n";

/**
 * 把宿主环境事实翻成"面板要显示的三行"。
 *
 * 抽成纯函数是为了让它可测(不必起 React),而且**只有这一处**决定"什么算可用":面板、导览、欢迎页
 * 里的那句状态都读它。四行的顺序 shell → node → python → ocr 也是固定的:前三行是"agent 能不能
 * 干活"(跑命令、跑脚本、装包),最后一行是"看不了图的模型能不能读图里的字"。
 */
export type EnvironmentRowStatus = "ok" | "partial" | "missing";

export interface EnvironmentRow {
  id: "shell" | "node" | "python" | "ocr";
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
   * 缺失的第三方包名(只有 Python 那一行会给)。
   *
   * 单独给一份,而不是让界面从 `hint` 里抠字符串:那句提示是给**人**看的文案,措辞随时会变,
   * 而从文案里反解数据是个必然出错的耦合。
   */
  missingPackages?: string[];
  /**
   * 这一行**不是"agent 能不能干活"的前提**。
   *
   * 缺了只影响某个功能(数据功能缺组件、看不了图的模型读不出文字),不该让导览页说"还没准备好" ——
   * 用户会以为整个应用不能用,而实际上只是少了一件事。判定"全都准备好了"时跳过这些行。
   */
  optional?: boolean;
  /**
   * 缺失时的出路。面板只给入口,绝不自动跑:
   * - `python-download`:连内置那份都没有(打包时跳过/被破坏)→ 只能引导用户装 Python;
   * - `install-python-packages`:Python 有、缺第三方包 → 用户点一次,装进**内置那份**。
   */
  action?: "python-download" | "install-python-packages";
}

/**
 * 有没有**必须提醒用户**的问题。
 *
 * 只有"非可选"的行没就绪才算问题:命令行与 Node 是 agent 能不能干活的前提;数据组件、文字识别
 * 缺了只影响某个功能。**就绪时一律什么都不说** —— 把"命令行已就绪"印在输入框底下既不改变用户
 * 能做什么,又拿术语占了一行。
 *
 * 抽出来是为了让"什么时候该说话"这件事有名字、也有测试,而不是散在几处 JSX 里的布尔表达式。
 */
export function environmentNeedsAttention(rows: readonly EnvironmentRow[]): boolean {
  return rows.some((row) => row.optional !== true && row.status !== "ok");
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
        // **缺 Python 也不该提醒** —— 只有数据功能需要它。之前这条分支漏了 `optional`,
        // 于是"没装 Python"会被当成"agent 跑不起来",在新建页弹出一句吓人的警告。
        optional: true,
        status: "missing",
        detail: t("environmentMissing"),
        hint: t("environmentPythonMissing"),
        action: "python-download",
      }
    : {
        id: "python",
        labelKey: "environmentPython",
        // 数据功能才需要 Python:缺了它 agent 照样跑命令、写代码。
        optional: true,
        // **有 python ≠ 有 pandas**:数据功能要的是依赖齐全的那个运行时,所以这里要分开说。
        status: missingPackages.length > 0 ? "partial" : "ok",
        // 只给版本号,不带 "Python" —— 行标签已经写着 Python 了,再写一遍就是三行里三个 Python。
        version: facts.python.version ?? "?",
        // 内置那份要标出来:用户照着"没有 Python 也能用"去理解时,得知道跑的是哪一个。
        detail: facts.python.source === "wordless" ? t("environmentPythonWordless") : t("environmentNodeSystem"),
        // **只在它是真路径时才显示**。系统装的 Python 常常只解析出一个命令名(`python3`),
        // 那不是"位置",只是把行标签又写了一遍;自带那份则是绝对路径,值得显示。
        ...(isAbsoluteExecutable(facts.python.executable) ? { location: facts.python.executable } : {}),
        ...(missingPackages.length > 0
          ? {
              hint: t("environmentPythonPackages").replace("{packages}", missingPackages.join(", ")),
              missingPackages,
              action: "install-python-packages" as const,
            }
          : {}),
      };

  // 文字识别:前三行是"能不能干活",这一行是"看不了图的模型能不能读图里的字"。
  // 没有它**不是错误**(构建时可以不带资产),但要说清后果:看不了图的模型读不出图里的文字。
  const ocr: EnvironmentRow = facts.ocr?.available
    ? {
        id: "ocr",
        labelKey: "environmentOcr",
        // 看不了图的模型才用得上它:没有它,能看图的模型一切照旧。
        optional: true,
        status: "ok",
        ...(facts.ocr.modelSet === null ? {} : { version: facts.ocr.modelSet }),
        detail: t("environmentOcrWordless"),
      }
    : {
        id: "ocr",
        labelKey: "environmentOcr",
        optional: true,
        status: "missing",
        detail: t("environmentMissing"),
        hint: t("environmentOcrMissing"),
      };

  return [shell, node, python, ocr];
}

/**
 * 是不是一个**真路径**(而不是从 PATH 里解析出来的命令名)。
 *
 * `python3` 这种名字告诉不了用户任何位置信息;`/Users/…/runtimes/python/3.12.14/bin/python3`
 * 或 `C:\…\python.exe` 才是。判定写成纯函数,方便单测。
 */
export function isAbsoluteExecutable(executable: string | undefined): boolean {
  if (!executable) return false;
  return executable.startsWith("/") || /^[A-Za-z]:[\\/]/.test(executable);
}
