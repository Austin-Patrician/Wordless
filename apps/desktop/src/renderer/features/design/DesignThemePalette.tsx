import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";
import { usePreferences } from "../../shared/preferences";
import { parseThemeTokens } from "./style-tokens.ts";

/**
 * 画布上的**色彩系统**面板:当前这份设计的 `@theme` 令牌。
 *
 * ## 读的是磁盘上那份 `theme.css`,不是目录里的模板
 *
 * 应用一套风格只是把令牌**拷进**设计包,之后 agent 会按规范继续改它 —— 于是"这套设计现在用
 * 什么色"的答案只在文件里。所以这里每次都读文件(走既有的 `readSessionWorkspaceTextFile`
 * 通道,不新开一条),而不是拿目录里的 `themeCss` 充数。
 *
 * ## token 名不翻译
 *
 * `primary` / `surface-raised` 是**写进 `theme.css` 的标识符**:用户对 agent 说的、agent 读到
 * 的是它。译成"主色"就与文件对不上了。
 *
 * ## 点色块 = 选中并交给对话(多选)
 *
 * 用户看到一块颜色,但他说不出 `--color-primary` 这个名字 —— 而"用户指的是哪一个令牌"正是这个
 * 面板唯一能替他说的事。所以点一下就把**那个令牌**挂进输入框(`theme-token-reference`,带变量名
 * 与值),再点一次取消。
 *
 * 与参考实现的两处差别,都是刻意的:
 * - **多选**:我们挂附件的那条通道本来就是列表、逐个可删,而"`primary` 和 `accent` 都调暗"是
 *   真实诉求。参考实现的 `setPromptAttachment` 是单数(一次一个)。
 * - **挂的是令牌,不是文件**:文件那一半信息设计画像早就给过模型("令牌都在 theme.css"),真正
 *   缺的是"用户指哪一个"。这也是这一轮把引用类型扩出一种的原因。
 *
 * ## 面板不写文件
 *
 * 它只读、只把选择交给对话;改令牌永远是 agent 的事 —— 与 §12.3"令牌的增量修改归 agent"一致。
 * 用户补一句"把主按钮换成这个",模型同时拿到那句话与这个引用块,再去改 `theme.css`,画布靠既有
 * 的刷新链路跟上。
 *
 * 本文件不 import Electron。
 */
export function DesignThemePalette({
  attachedTokens,
  bridge,
  onClose,
  onToggleToken,
  /** 当前设计刷新时变一次,用来重新读文件。 */
  revision,
  sessionId,
  /** 工作区相对的 `theme.css` 路径。取不出来(设计包不在工作区内)时为 null。 */
  themePath,
}: {
  /** 已经挂在输入框上的令牌名(带 `--color-` 前缀)。选中态直接读它 —— 内存里再存一份就会漂。 */
  attachedTokens: readonly string[];
  bridge: DesktopBridge;
  onClose: () => void;
  /** 点一个色块:没挂就挂上,已挂就摘掉。 */
  onToggleToken: (token: { name: string; value: string }) => void;
  revision: string;
  sessionId: string;
  themePath: string | null;
}) {
  const { t } = usePreferences();
  const [tokens, setTokens] = useState<{ name: string; value: string }[] | null>(null);

  useEffect(() => {
    if (themePath === null) {
      setTokens([]);
      return;
    }
    let active = true;
    void bridge
      .readSessionWorkspaceTextFile(sessionId, themePath)
      .then((file) => {
        if (!active) return;
        if (file.status !== "available") {
          setTokens([]);
          return;
        }
        const { colors } = parseThemeTokens(file.content);
        // 声明顺序即文件里的顺序;不重排 —— 文件里怎么写的,面板里就怎么读。
        setTokens(Object.entries(colors).map(([name, value]) => ({ name, value })));
      })
      .catch(() => {
        if (active) setTokens([]);
      });
    return () => {
      active = false;
    };
  }, [bridge, revision, sessionId, themePath]);

  return (
    <aside
      aria-label={t("designThemeTitle")}
      className="absolute left-1/2 top-3 z-40 w-[min(46rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-xl border border-[#e2e4e6] bg-white/95 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.14)] backdrop-blur dark:border-border dark:bg-card/95"
    >
      <header className="flex items-center gap-2">
        <h2 className="text-[12px] font-semibold text-[#20201f] dark:text-foreground">{t("designThemeTitle")}</h2>
        <span className="text-[10px] text-[#8a8f94] dark:text-muted-foreground">{t("designThemeHint")}</span>
        <span className="flex-1" />
        <button
          aria-label={t("designStyleClose")}
          className="grid h-6 w-6 place-items-center rounded-[6px] text-[#65655f] hover:bg-[#f0f0ec] dark:text-muted-foreground dark:hover:bg-muted"
          onClick={onClose}
          type="button"
        >
          <X className="h-3 w-3" />
        </button>
      </header>

      {tokens === null ? (
        <p className="mt-2 text-[11px] text-[#8a8f94] dark:text-muted-foreground">{t("designLibraryLoading")}</p>
      ) : tokens.length === 0 ? (
        // 空态要解释:读不到文件与"这份设计还没应用风格"是两件事,而这里分不出是哪种 —— 于是
        // 说的是两边都成立的那句。
        <p className="mt-2 text-[11px] text-[#8a8f94] dark:text-muted-foreground">{t("designThemeEmpty")}</p>
      ) : (
        <ul className="mt-2 grid max-h-[38vh] grid-cols-4 gap-1 overflow-y-auto">
          {tokens.map((token) => {
            const variable = `--color-${token.name}`;
            const attached = attachedTokens.includes(variable);
            return (
              <li key={token.name}>
                <button
                  aria-label={t("designThemeToggle").replace("{token}", variable)}
                  aria-pressed={attached}
                  className={`flex w-full min-w-0 items-center gap-1.5 rounded-[6px] px-1 py-1 text-left transition-colors ${
                    attached
                      ? "bg-[#efe8fb] ring-1 ring-[#8f7cc0] dark:bg-[#312b52] dark:ring-[#5c5187]"
                      : "hover:bg-[#f4f5f4] dark:hover:bg-muted"
                  }`}
                  onClick={() => onToggleToken({ name: variable, value: token.value })}
                  title={`${variable}: ${token.value}`}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`size-3.5 shrink-0 rounded-[4px] border ${
                      attached ? "border-[#8f7cc0]" : "border-black/10 dark:border-white/15"
                    }`}
                    style={{ background: token.value }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] text-[#3e3e39] dark:text-foreground">{token.name}</span>
                    <span className="block truncate text-[9px] text-[#a8adb2] dark:text-muted-foreground">{token.value}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
