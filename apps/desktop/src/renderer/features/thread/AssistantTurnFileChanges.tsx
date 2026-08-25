import { memo } from "react";
import { FileTypeIcon } from "../../shared/FileTypeIcon";
import { usePreferences } from "../../shared/preferences";
import type { FileChangeSelection } from "../workbench/context-panel-types";
import {
  turnFileChanges,
  visibleTurnFileChanges,
  type TurnFileChange,
} from "./turn-file-changes";
import type { ConversationMessage } from "@wordless/protocol";

type AssistantTurnFileChangesProps = {
  messages: readonly ConversationMessage[];
  onOpen?: (selection: FileChangeSelection) => void;
};

function formatCount(template: string, count: number): string {
  return template.replaceAll("{count}", String(count));
}

function FileChangeChip({
  change,
  onOpen,
}: {
  change: TurnFileChange;
  onOpen?: (selection: FileChangeSelection) => void;
}) {
  const created = change.kind === "created";
  return (
    <button
      className="flex h-8 w-full min-w-0 items-center gap-2 rounded-[5px] px-2 text-left text-[12px] text-[#454540] transition-colors hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-foreground dark:hover:bg-white/[0.06]"
      onClick={() => onOpen?.({ path: change.path, name: change.name })}
      title={change.path}
      type="button"
    >
      <FileTypeIcon
        className="h-3 w-3 shrink-0 [&_svg]:h-3 [&_svg]:w-3"
        kind="file"
        name={change.name}
      />
      <span className="min-w-0 flex-1 truncate font-medium">{change.name}</span>
      <span
        className={`shrink-0 font-mono text-[10px] ${created ? "text-[#5d823e] dark:text-[#a9cf78]" : "text-[#8a8a83] dark:text-muted-foreground"}`}
      >
        {created ? "A" : "M"}
      </span>
    </button>
  );
}

export const AssistantTurnFileChanges = memo(function AssistantTurnFileChanges({
  messages,
  onOpen,
}: AssistantTurnFileChangesProps) {
  const { t } = usePreferences();
  const changes = turnFileChanges(messages);
  if (changes.length === 0) return null;
  const { hiddenCount, visible } = visibleTurnFileChanges(changes);
  return (
    <section
      aria-label={t("turnFileChanges")}
      className="mt-2 overflow-hidden rounded-[10px] border border-[#dcdcd7] bg-white/50 shadow-[0_1px_0_rgba(255,255,255,0.45)_inset] dark:border-border dark:bg-card/45 dark:shadow-none"
      data-thread-search-exclude
    >
      <header className="flex h-8 items-center gap-3 border-b border-[#deded9] px-2.5 text-[11px] text-[#777770] dark:border-border dark:text-muted-foreground">
        <span className="min-w-0 flex-1 truncate font-medium">
          {formatCount(t("turnFileChanges"), changes.length)}
        </span>
        <button
          className="shrink-0 rounded-[4px] px-1.5 py-0.5 font-medium text-[#65655f] hover:bg-white/75 hover:text-[#3f3f3a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-muted-foreground dark:hover:bg-white/[0.06] dark:hover:text-foreground"
          onClick={() => onOpen?.({ path: null, name: "" })}
          type="button"
        >
          {t("toolViewChange")}
        </button>
      </header>
      <div className="p-1">
        {visible.map((change) => (
          <FileChangeChip change={change} key={change.path} onOpen={onOpen} />
        ))}
        {hiddenCount > 0 ? (
          <button
            className="flex h-7 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[11px] text-[#777770] hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-muted-foreground dark:hover:bg-white/[0.06]"
            onClick={() => onOpen?.({ path: null, name: "" })}
            type="button"
          >
            <span aria-hidden className="w-3 text-center font-mono">···</span>
            <span>{formatCount(t("turnFileChangesMore"), hiddenCount)}</span>
          </button>
        ) : null}
      </div>
    </section>
  );
});
