import type { ConfiguredModelKind, ConfiguredProviderSummary, ProviderAvatarId } from "@wordless/domain";
import { Button } from "@wordless/ui-kit";
import { Bot, ImageIcon, Plus } from "lucide-react";
import { useState } from "react";
import { AddCustomProviderDialog } from "./AddCustomProviderDialog";
import { ProviderIcon } from "./provider-icons";
import { usePreferences } from "../../shared/preferences";

type ProviderSidebarProps = {
  addingDisabled: boolean;
  kind: ConfiguredModelKind;
  onAddProvider: (providerId: string, avatarId: ProviderAvatarId) => Promise<void>;
  onKindChange: (kind: ConfiguredModelKind) => void;
  onSelectProvider: (providerId: string) => void;
  providers: ConfiguredProviderSummary[];
  selectedProviderId: string | null;
};

export function ProviderSidebar({ addingDisabled, kind, onAddProvider, onKindChange, onSelectProvider, providers, selectedProviderId }: ProviderSidebarProps) {
  const { t } = usePreferences();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <aside className="flex w-[235px] shrink-0 flex-col border-r border-border bg-[#fafafa] p-3 dark:bg-[#1d1f22]">
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-[#eeeeef] p-1 dark:bg-[#2b2e32]">
        <button className={`rounded-md px-2 py-1.5 text-[12px] ${kind === "chat" ? "bg-white shadow-sm dark:bg-[#383b40]" : "text-muted-foreground"}`} onClick={() => onKindChange("chat")} type="button"><Bot className="mr-1 inline h-3.5 w-3.5" />LLM</button>
        <button className={`rounded-md px-2 py-1.5 text-[12px] ${kind === "image" ? "bg-white shadow-sm dark:bg-[#383b40]" : "text-muted-foreground"}`} onClick={() => onKindChange("image")} type="button"><ImageIcon className="mr-1 inline h-3.5 w-3.5" />Image</button>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {providers.map((provider) => (
          <button
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] ${provider.id === selectedProviderId ? "bg-white shadow-sm dark:bg-[#303338]" : "hover:bg-[#eeeeef] dark:hover:bg-[#292c30]"}`}
            key={provider.id}
            onClick={() => onSelectProvider(provider.id)}
            type="button"
          >
            <ProviderIcon avatarId={provider.avatarId} className="size-4 shrink-0 object-contain" providerId={provider.id} />
            <span className={`size-1.5 shrink-0 rounded-full ${provider.authStatus === "configured" ? "bg-[#57a773]" : "bg-[#b8bbc0]"}`} />
            <span className="min-w-0 flex-1 truncate">{provider.displayName}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{provider.enabledModelCount}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 border-t border-border pt-3">
        <Button className="w-full justify-start" disabled={addingDisabled} onClick={() => setAdding(true)} size="sm" type="button" variant="outline"><Plus className="h-3.5 w-3.5" />{t("addCustomProvider")}</Button>
      </div>
      </aside>
      <AddCustomProviderDialog disabled={addingDisabled} kind={kind} onAdd={onAddProvider} onOpenChange={setAdding} open={adding} providerIds={providers.map((provider) => provider.id)} />
    </>
  );
}
