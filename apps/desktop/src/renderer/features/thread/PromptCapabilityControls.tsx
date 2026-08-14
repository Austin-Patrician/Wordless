import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Switch,
} from "@wordless/ui-kit";
import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ConnectorSummary, SkillSummary } from "@wordless/domain";
import { ConnectorIcon } from "../../shared/ConnectorIcon";
import { SkillIcon } from "../../shared/SkillIcon";
import { usePreferences } from "../../shared/preferences";
import mcpIcon from "../../../icons/common-icons/mcp.svg";
import skillsIcon from "../../../icons/common-icons/skills.svg";

function MenuTrigger({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <DropdownMenuTrigger
      className="inline-flex h-8 max-w-[180px] items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[11px] font-medium text-[#555650] outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:text-foreground"
      type="button"
    >
      {icon}
      <span className="truncate">{label}</span>
      <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
    </DropdownMenuTrigger>
  );
}

export function SkillInsertMenu({
  label,
  onSelect,
  skills,
}: {
  label?: string;
  onSelect: (skill: SkillSummary) => void;
  skills: SkillSummary[];
}) {
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filteredSkills = skills.filter((skill) =>
    `${skill.name} ${skill.description}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );

  return (
    <DropdownMenu
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
      open={open}
    >
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex h-8 max-w-[180px] items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[11px] font-medium text-[#555650] outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:text-foreground"
          type="button"
        >
          <img
            alt=""
            className="h-3.5 w-3.5 shrink-0 object-contain dark:invert"
            src={skillsIcon}
          />
          <span className="truncate">{label ?? t("automationSkills")}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[294px] p-2"
        onCloseAutoFocus={(event) => event.preventDefault()}
        side="top"
        sideOffset={6}
      >
          <input
            aria-label={t("automationSearchSkills")}
            autoFocus
            className="h-8 w-full rounded-[6px] border border-[#e4e4df] bg-[#fafaf8] px-2 text-[12px] text-[#3f3f3a] outline-none placeholder:text-[#9b9b94] focus:border-[#9dad75] dark:border-border dark:bg-muted dark:text-foreground"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("automationSearchSkills")}
            value={query}
          />
          <div className="mt-1 max-h-[232px] overflow-y-auto overscroll-contain">
            {filteredSkills.map((skill) => (
              <button
                className="flex h-auto min-h-0 w-full items-start gap-2 rounded-sm px-1.5 py-2 text-left outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                key={skill.id}
                onClick={() => {
                  onSelect(skill);
                  setOpen(false);
                  setQuery("");
                }}
                onMouseDown={(event) => event.preventDefault()}
                role="menuitem"
                type="button"
              >
                <SkillIcon
                  className="mt-0.5 h-5 w-5 shrink-0 rounded-[5px] bg-[#f2f2ef] text-[#55554f] dark:bg-muted dark:text-muted-foreground"
                  name={skill.name}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold">
                    {skill.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] leading-4 text-muted-foreground">
                    {skill.description}
                  </span>
                </span>
              </button>
            ))}
            {filteredSkills.length === 0 ? (
              <p className="px-2 py-3 text-[11px] text-muted-foreground">
                {skills.length ? t("automationNoMatchingSkills") : t("automationNoSkills")}
              </p>
            ) : null}
          </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ConnectorSwitchMenu({
  connectors,
  label,
  onChange,
  selected,
  side = "bottom",
}: {
  connectors: ConnectorSummary[];
  label?: string;
  onChange: (ids: string[]) => void;
  selected: string[];
  side?: "bottom" | "top";
}) {
  const { t } = usePreferences();
  const setSelected = (connectorId: string, checked: boolean) => {
    onChange(
      checked
        ? [...new Set([...selected, connectorId])]
        : selected.filter((id) => id !== connectorId),
    );
  };
  const menuLabel = label ?? t("connectors");

  return (
    <DropdownMenu>
      <MenuTrigger
        icon={
          <img
            alt=""
            className="h-3.5 w-3.5 shrink-0 object-contain dark:invert"
            src={mcpIcon}
          />
        }
        label={selected.length ? `${menuLabel} ${selected.length}` : menuLabel}
      />
      <DropdownMenuContent
        align="start"
        className="w-[248px] p-1.5"
        onCloseAutoFocus={(event) => event.preventDefault()}
        side={side}
        sideOffset={6}
      >
        <div className="max-h-[232px] overflow-y-auto overscroll-contain">
          {connectors.map((connector) => {
            const checked = selected.includes(connector.id);
            return (
              <div
                className="flex h-10 min-w-0 items-center gap-2 rounded-[7px] px-2 hover:bg-[#f3f3f0] dark:hover:bg-muted"
                key={connector.id}
              >
                <ConnectorIcon
                  className="h-4 w-4 shrink-0"
                  templateId={connector.templateId}
                  transport={connector.transport}
                />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                  {connector.name}
                </span>
                <Switch
                  aria-label={`${checked ? t("automationDisable") : t("automationEnable")} ${connector.name}`}
                  checked={checked}
                  onCheckedChange={(next) => setSelected(connector.id, next)}
                />
              </div>
            );
          })}
          {connectors.length === 0 ? (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">
              {t("automationNoConnectors")}
            </p>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
