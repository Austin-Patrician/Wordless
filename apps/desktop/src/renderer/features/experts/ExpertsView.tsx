import {
  ArrowRight,
  Brain,
  Check,
  ChevronDown,
  Crown,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@wordless/ui-kit";
import type {
  ConnectorSummary,
  EnabledModelRecord,
  ExpertDefinition,
  ExpertDefinitionInput,
  ExpertExecutionProfile,
  ExpertPortrait as ExpertPortraitValue,
  ExpertSelection,
  ExpertTeamDefinition,
  ExpertTeamDefinitionInput,
  ExpertTeamDetail,
  ExpertTeamMemberDefinition,
  ExpertSummary,
  ModelReference,
  ProviderConnectionRecord,
  SkillSummary,
  ThinkingLevel,
} from "@wordless/domain";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { ExpertPortrait } from "./ExpertPortrait";
import { PortraitEditor } from "./PortraitEditor";
import { DEFAULT_AVATAAARS_OPTIONS } from "./avataaars-portrait";
import { ProviderIcon } from "../settings/provider-icons";
import followComposerIcon from "../../../icons/common-icons/follow_composer.svg";
import { usePreferences } from "../../shared/preferences";
import type { MessageKey } from "../../shared/i18n";
import {
  InlineSkillComposer,
  type InlineSkillComposerHandle,
  type InlineSkillComposerValue,
} from "../thread/InlineSkillComposer";
import {
  ConnectorSwitchMenu,
  SkillInsertMenu,
} from "../thread/PromptCapabilityControls";

type SummonRequest = { selection: ExpertSelection; initialPrompt?: string };
const executionProfileKeys: Record<ExpertExecutionProfile, MessageKey> = {
  "read-only": "expertsReadOnly",
  review: "expertsReview",
  research: "expertsResearch",
  "workspace-write": "expertsWorkspaceWrite",
};
const EMPTY_EXPERT_PROMPT_VALUE: InlineSkillComposerValue = {
  parts: [],
  skillIds: [],
  skillTokenCounts: {},
  skillQuery: null,
  text: "",
  workspaceReferenceCount: 0,
  workspaceQuery: null,
};

function executionProfileLabel(
  profile: ExpertExecutionProfile,
  t: ReturnType<typeof usePreferences>["t"],
): string {
  return t(executionProfileKeys[profile]);
}

export function ExpertsView({
  onSummon,
}: {
  onSummon: (request: SummonRequest) => void;
}) {
  const client = useRuntimeClient();
  const { refresh, snapshot } = useRuntime();
  const { t } = usePreferences();
  const [creating, setCreating] = useState<"expert" | "team" | null>(null);
  const [editingExpert, setEditingExpert] = useState<ExpertDefinition | null>(null);
  const [editingTeam, setEditingTeam] = useState<ExpertTeamDefinition | null>(null);
  const [expertDefinitions, setExpertDefinitions] = useState<ExpertDefinition[]>([]);
  const [tab, setTab] = useState<"expert" | "team">("expert");
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState(false);
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<ExpertSummary | null>(null);
  const [teamDetail, setTeamDetail] = useState<ExpertTeamDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const experts =
    snapshot?.experts.filter((expert) => expert.kind === "expert") ?? [];
  const teams =
    snapshot?.experts.filter((expert) => expert.kind === "team") ?? [];
  const source = tab === "expert" ? experts : teams;
  const categories = [
    ...new Set(source.flatMap((item) => item.categories ?? [])),
  ];
  const results = useMemo(
    () =>
      source.filter(
        (item) =>
          (!mine || item.source === "local") &&
          (category === "all" || item.categories?.includes(category)) &&
          `${item.name} ${item.description} ${item.roleLabel ?? ""} ${(item.tags ?? []).join(" ")}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
      ),
    [category, mine, query, source],
  );
  useEffect(() => {
    if (!selected || selected.kind !== "team") {
      setTeamDetail(null);
      setDetailError(null);
      return;
    }
    let active = true;
    setTeamDetail(null);
    setDetailError(null);
    void client
      .getExpertTeamDetail(selected.id)
      .then((detail) => {
        if (active) setTeamDetail(detail);
      })
      .catch(() => {
        if (active) setDetailError(t("expertsDetailLoadFailed"));
      });
    return () => {
      active = false;
    };
  }, [client, selected, t]);
  useEffect(() => {
    if (creating !== "team" && !editingTeam) return;
    void client.listExperts().then((local) => {
      const localIds = new Set(local.map((expert) => expert.id));
      const builtin = (snapshot?.experts ?? []).flatMap((expert): ExpertDefinition[] => expert.kind === "expert" && !localIds.has(expert.id)
        ? [{
            ...expert,
            kind: "expert",
            systemPrompt: `You are ${expert.name}. ${expert.description}`,
            skillIds: [],
            connectorIds: [],
            createdAt: 0,
            updatedAt: 0,
          }]
        : []);
      setExpertDefinitions([...local, ...builtin]);
    }).catch(() => setExpertDefinitions([]));
  }, [client, creating, editingTeam, snapshot?.experts]);

  const summon = (selection: ExpertSelection, initialPrompt?: string) =>
    onSummon({ selection, initialPrompt });
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#fbfbfa] dark:bg-background">
      <header className="flex h-[62px] shrink-0 items-center px-5 sm:px-8">
        <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-3">
          <nav
            aria-label={t("expertsNavigation")}
            className="inline-flex border-b border-[#deded9] dark:border-border"
          >
            <button
              className={`border-b-2 px-4 pb-2 text-[13px] font-semibold transition-colors ${tab === "expert" ? "border-[#252624] text-[#252624] dark:border-foreground dark:text-foreground" : "border-transparent text-[#888881] hover:text-[#4a4a45] dark:text-muted-foreground dark:hover:text-foreground"}`}
              onClick={() => {
                setTab("expert");
                setCategory("all");
              }}
              type="button"
            >
              {t("expertsEmployees")}
            </button>
            <button
              className={`border-b-2 px-4 pb-2 text-[13px] font-semibold transition-colors ${tab === "team" ? "border-[#252624] text-[#252624] dark:border-foreground dark:text-foreground" : "border-transparent text-[#888881] hover:text-[#4a4a45] dark:text-muted-foreground dark:hover:text-foreground"}`}
              onClick={() => {
                setTab("team");
                setCategory("all");
              }}
              type="button"
            >
              {t("expertsTeams")}
            </button>
          </nav>
          <div className="flex items-center gap-2">
            <label className="flex h-8 w-[220px] items-center gap-1.5 rounded-[7px] border border-[#deded8] bg-[#f4f4f2] px-2.5 dark:border-border dark:bg-muted">
              <Search className="h-3.5 w-3.5 text-[#85867e]" />
              <input
                className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("expertsSearch")}
                value={query}
              />
            </label>
            <button
              className={`flex h-8 items-center rounded-[7px] border px-3 text-[11px] font-medium ${mine ? "border-[#c7e56d] bg-[#eff9d3] text-[#44551b]" : "border-[#deded8] bg-white text-[#464741] dark:border-border dark:bg-card dark:text-foreground"}`}
              onClick={() => setMine((value) => !value)}
              type="button"
            >
              <UserRound className="mr-1 h-3.5 w-3.5" />
              {t("expertsMine")}
            </button>
            <button
              className="grid h-8 w-8 place-items-center rounded-[7px] border border-[#deded8] bg-white dark:border-border dark:bg-card"
              onClick={() => setCreating(tab)}
              title={tab === "expert" ? t("expertsEmployees") : t("expertsTeams")}
              type="button"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        <div className="mx-auto w-full max-w-[1280px]">
          <div className="mb-4">
            <h1 className="text-[18px] font-semibold text-[#262723] dark:text-foreground">
              {tab === "expert" ? t("expertsEmployees") : t("expertsTeams")}
            </h1>
            {tab === "team" ? (
              <p className="mt-1 text-[11px] text-[#85867e]">
                {t("expertsTeamSubtitle")}
              </p>
            ) : null}
          </div>
          {categories.length ? (
            <div className="mb-4 flex flex-wrap gap-1.5">
              <button
                className={`rounded-[5px] px-2.5 py-1.5 text-[10px] ${category === "all" ? "bg-[#efefec] font-semibold" : "text-[#777870]"}`}
                onClick={() => setCategory("all")}
                type="button"
              >
                {t("expertsAll")}
              </button>
              {categories.map((item) => (
                <button
                  className={`rounded-[5px] px-2.5 py-1.5 text-[10px] ${category === item ? "bg-[#efefec] font-semibold" : "text-[#777870]"}`}
                  key={item}
                  onClick={() => setCategory(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {results.map((item) => (
              <article
                className="group relative cursor-pointer rounded-[8px] border border-[#e9e9e4] bg-white p-4 shadow-[0_7px_18px_rgba(35,36,31,.03)] transition-colors hover:border-[#d9d9d3] hover:bg-[#f6f6f3] dark:border-border dark:bg-card"
                key={item.id}
                onClick={() => setSelected(item)}
              >
                <button
                  className="absolute right-4 top-4 rounded-[6px] bg-[#292a27] px-2.5 py-1.5 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    summon({
                      kind: item.kind,
                      id: item.id,
                      version: item.version,
                    });
                  }}
                  type="button"
                >
                  {t("expertsSummon")}
                </button>
                <div className="flex items-center gap-3">
                  {item.kind === "team" ? (
                    <div className="flex -space-x-2">
                      <ExpertPortrait
                        className="h-9 w-9 border-2 border-white"
                        name={item.name}
                        portrait={item.portrait}
                      />
                      <UsersRound className="h-9 w-9 rounded-full border-2 border-white bg-[#dbe6d0] p-2 text-[#5b7048]" />
                    </div>
                  ) : (
                    <ExpertPortrait
                      className="h-10 w-10"
                      name={item.name}
                      portrait={item.portrait}
                    />
                  )}
                  <div className="min-w-0">
                    <h2 className="truncate text-[13px] font-semibold text-[#2f302c] dark:text-foreground">
                      {item.name}
                    </h2>
                    <p className="mt-0.5 text-[10px] text-[#777870]">
                      {item.roleLabel ??
                        (item.kind === "team"
                          ? `${item.memberCount ?? 0} ${t("expertsCollaborating")}`
                          : t("expertsGeneralWork"))}
                    </p>
                  </div>
                </div>
                <p className="mt-4 min-h-10 line-clamp-2 text-[11px] leading-5 text-[#666760] dark:text-muted-foreground">
                  {item.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(item.tags ?? []).map((tag) => (
                    <span
                      className="rounded-[4px] bg-[#f1f1ee] px-2 py-1 text-[9px] text-[#6d6e66] dark:bg-muted"
                      key={tag}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {results.length === 0 ? (
            <div className="py-20 text-center text-[12px] text-[#8c8d85]">
              {t("expertsNoMatches")}
            </div>
          ) : null}
        </div>
      </div>
      {selected ? (
        <ExpertDetailDialog
          detail={selected.kind === "team" ? teamDetail : null}
          error={detailError}
          onClose={() => setSelected(null)}
          onEdit={
            selected.source === "local"
              ? selected.kind === "expert"
                ? () => {
                  void client.listExperts().then((experts) => {
                    const expert = experts.find((item) => item.id === selected.id);
                    if (!expert) return;
                    setEditingExpert(expert);
                    setSelected(null);
                  });
                }
                : () => {
                    void client.listExpertTeams().then((teams) => {
                      const team = teams.find((item) => item.id === selected.id);
                      if (!team) return;
                      setEditingTeam(team);
                      setSelected(null);
                    });
                  }
              : undefined
          }
          onSummon={(prompt) =>
            summon(
              {
                kind: selected.kind,
                id: selected.id,
                version: selected.version,
              },
              prompt,
            )
          }
          summary={selected}
        />
      ) : null}
      {(creating === "expert" || editingExpert) && snapshot ? (
        <ExpertEditor
          connectors={snapshot.connectors.connectors.filter(
            (connector) => connector.enabled,
          )}
          initial={editingExpert ?? undefined}
          onClose={() => {
            setCreating(null);
            setEditingExpert(null);
          }}
          onSave={async (input) => {
            await client.saveExpert(input, editingExpert?.id);
            await refresh();
            setCreating(null);
            setEditingExpert(null);
          }}
          skills={snapshot.skills.skills.filter(
            (skill) => skill.enabled && skill.state === "active",
          )}
        />
      ) : null}
      {(creating === "team" || editingTeam) && snapshot ? (
        <TeamEditor
          connectors={snapshot.connectors.connectors.filter((connector) => connector.enabled)}
          connections={snapshot.connections}
          experts={expertDefinitions}
          initial={editingTeam ?? undefined}
          models={snapshot.models.filter((model) => model.enabled)}
          onClose={() => {
            setCreating(null);
            setEditingTeam(null);
          }}
          onSave={async (input) => {
            await client.saveExpertTeam(input, editingTeam?.id);
            await refresh();
            setCreating(null);
            setEditingTeam(null);
          }}
          skills={snapshot.skills.skills.filter((skill) => skill.enabled && skill.state === "active")}
        />
      ) : null}
    </section>
  );
}

function ExpertDetailDialog({
  detail,
  error,
  onClose,
  onEdit,
  onSummon,
  summary,
}: {
  detail: ExpertTeamDetail | null;
  error: string | null;
  onClose: () => void;
  onEdit?: () => void;
  onSummon: (prompt?: string) => void;
  summary: ExpertSummary;
}) {
  const { t } = usePreferences();
  const isTeam = summary.kind === "team";
  const shown = detail ?? summary;
  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-black/35 p-4"
      onMouseDown={onClose}
    >
      <section
        className="flex max-h-[calc(100vh-96px)] w-full max-w-[560px] flex-col overflow-hidden rounded-[8px] bg-white p-5 shadow-[0_24px_60px_rgba(0,0,0,.22)] dark:bg-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="shrink-0">
          <button
            className="float-right grid h-7 w-7 place-items-center rounded-[5px] text-[#9a9b94] hover:bg-[#f1f1ee]"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-start gap-3">
            <div className="flex -space-x-2">
              <ExpertPortrait
                className="h-11 w-11 border-2 border-white"
                name={summary.name}
                portrait={summary.portrait}
              />
              {isTeam ? (
                <UsersRound className="h-11 w-11 rounded-full border-2 border-white bg-[#dbe6d0] p-2.5 text-[#5b7048]" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2 pr-8">
                <h2 className="min-w-0 truncate text-[19px] font-semibold text-[#20211e] dark:text-foreground">
                  {summary.name}
                </h2>
                <button
                  className="h-7 shrink-0 whitespace-nowrap rounded-[6px] bg-black px-3 text-[11px] font-semibold text-white hover:bg-[#3a3b37]"
                  onClick={() => onSummon()}
                  type="button"
                >
                  {t("expertsSummon")}
                </button>
                {onEdit ? (
                  <button
                    aria-label={t(isTeam ? "expertsEditTeam" : "expertsEditEmployee")}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] border border-[#deded8] text-[#666760] hover:bg-muted dark:border-border"
                    onClick={onEdit}
                    title={t(isTeam ? "expertsEditTeam" : "expertsEditEmployee")}
                    type="button"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] text-[#777870]">
                {summary.roleLabel ??
                  (isTeam
                    ? `${summary.memberCount ?? 0} ${t("expertsCollaborating")}`
                    : t("expertsGeneralWork"))}
              </p>
            </div>
          </div>
          <p className="mt-5 text-[13px] leading-6 text-[#3f403b] dark:text-muted-foreground">
            {shown.description}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(shown.tags ?? []).map((tag) => (
              <span
                className="rounded-[5px] bg-[#f0f0ed] px-2.5 py-1.5 text-[10px] text-[#64655e] dark:bg-muted"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
        <div className="-mx-5 mt-5 min-h-0 flex-1 overflow-y-auto">
          <div className="px-5 pr-6">
            {isTeam && !detail && !error ? (
              <div className="grid h-36 place-items-center">
                <LoaderCircle className="h-4 w-4 animate-spin text-[#7e8d58]" />
              </div>
            ) : null}
            {error ? (
              <p className="mt-6 text-[12px] text-destructive">{error}</p>
            ) : null}
            {detail ? (
              <>
                <h3 className="mt-7 text-[15px] font-semibold">
                  {isTeam ? t("expertsTeamHelp") : t("expertsEmployeeHelp")}
                </h3>
                <div className="mt-3 space-y-1.5">
                  {detail.suggestedPrompts.map((prompt) => (
                    <button
                      className="flex w-full rounded-[7px] bg-[#f5f5f3] px-3.5 py-3 text-left text-[12px] leading-5 text-[#575850] transition-colors hover:bg-[#eceee5] dark:bg-muted"
                      key={prompt}
                      onClick={() => onSummon(prompt)}
                      type="button"
                    >
                      <span>{prompt}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-7 flex items-center gap-2">
                  <h3 className="text-[15px] font-semibold">
                  {t("expertsMembers")}
                  </h3>
                  <span className="text-[10px] text-[#898a82]">
                    {detail.members.length + 1}
                  </span>
                </div>
                <div className="mt-3 divide-y divide-[#eeeeea] border-y border-[#eeeeea] dark:divide-border dark:border-border">
                  <div className="flex items-start gap-3 py-3">
                    <ExpertPortrait
                      className="h-9 w-9"
                      name={detail.leader.name}
                      portrait={detail.leader.portrait}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-[12px] font-semibold text-[#373832] dark:text-foreground">
                          {detail.leader.name}
                        </p>
                        <span className="rounded-[4px] bg-[#edf2df] px-1.5 py-0.5 text-[9px] font-semibold text-[#60713d] dark:bg-[#33401f] dark:text-[#dce9bc]">
                          {t("expertsTeamLead")}
                        </span>
                        {!detail.leader.available ? (
                          <span className="rounded-[4px] bg-[#f2f2ef] px-1.5 py-0.5 text-[9px] text-[#8a8a83]">
                            {t("expertsUnavailable")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-[#6a6b63] dark:text-muted-foreground">
                        {t("expertsTeamLeadResponsibility")}
                      </p>
                    </div>
                  </div>
                  {detail.members.map((member) => (
                    <div
                      className="flex items-start gap-3 py-3"
                      key={member.id}
                    >
                      <ExpertPortrait
                        className="h-9 w-9"
                        name={member.name}
                        portrait={member.portrait}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-[12px] font-semibold text-[#373832] dark:text-foreground">
                            {member.name}
                          </p>
                          {!member.available ? (
                            <span className="rounded-[4px] bg-[#f2f2ef] px-1.5 py-0.5 text-[9px] text-[#8a8a83]">
                            {t("expertsUnavailable")}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[10px] font-medium text-[#74804f]">
                          {executionProfileLabel(
                            member.executionProfile,
                            t,
                          )}
                        </p>
                        <p className="mt-1 text-[11px] leading-5 text-[#6a6b63] dark:text-muted-foreground">
                          {member.responsibility}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function newTeamMember(index = 0): ExpertTeamMemberDefinition {
  return {
    id: crypto.randomUUID(),
    name: "",
    portrait: { kind: "avataaars", schemaVersion: 1, options: { ...DEFAULT_AVATAAARS_OPTIONS } },
    systemPrompt: "",
    skillIds: [],
    connectorIds: [],
    executionProfile: index === 0 ? "workspace-write" : "read-only",
    responsibility: "",
  };
}

const MEMBER_THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function memberThinkingLevelLabel(
  level: ThinkingLevel,
  t: ReturnType<typeof usePreferences>["t"],
): string {
  return t(`thinkingLevel_${level}` as MessageKey);
}

function clampMemberThinkingLevel(
  model: EnabledModelRecord,
  level: ThinkingLevel | undefined,
): ThinkingLevel | undefined {
  if (level === undefined) return undefined;
  if (!model.capabilities.supportsReasoning) return "off";
  const supported = model.capabilities.supportedThinkingLevels;
  if (supported.includes(level)) return level;
  const index = MEMBER_THINKING_LEVELS.indexOf(level);
  for (let next = index; next < MEMBER_THINKING_LEVELS.length; next += 1) {
    const candidate = MEMBER_THINKING_LEVELS[next];
    if (supported.includes(candidate)) return candidate;
  }
  for (let next = index - 1; next >= 0; next -= 1) {
    const candidate = MEMBER_THINKING_LEVELS[next];
    if (supported.includes(candidate)) return candidate;
  }
  return supported[0] ?? "off";
}

function MemberThinkingMenu({ level, model, onChange }: {
  level?: ThinkingLevel;
  model?: EnabledModelRecord;
  onChange: (level: ThinkingLevel | undefined) => void;
}) {
  const { t } = usePreferences();
  if (model && !model.capabilities.supportsReasoning)
    return <span className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 text-[10px] font-medium text-[#92938b]" title={t("expertsMemberThinking")}><Brain className="h-3.5 w-3.5" /><span>{memberThinkingLevelLabel("off", t)}</span></span>;
  const supported = model?.capabilities.supportedThinkingLevels ?? MEMBER_THINKING_LEVELS;
  return <DropdownMenu>
    <DropdownMenuTrigger className="inline-flex h-8 max-w-[132px] items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 text-[10px] font-medium text-[#555650] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring dark:text-foreground" title={t("expertsMemberThinking")} type="button"><Brain className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{level === undefined ? t("expertsFollowComposer") : memberThinkingLevelLabel(level, t)}</span><ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-[178px] p-1.5" onCloseAutoFocus={(event) => event.preventDefault()} side="top" sideOffset={6}>
      <DropdownMenuItem className="min-h-8 justify-between text-[11px]" onSelect={() => onChange(undefined)}>{t("expertsFollowComposer")}{level === undefined ? <Check className="h-3.5 w-3.5 text-[#6d8438]" /> : null}</DropdownMenuItem>
      {supported.map((candidate) => <DropdownMenuItem className="min-h-8 justify-between text-[11px]" key={candidate} onSelect={() => onChange(candidate)}>{memberThinkingLevelLabel(candidate, t)}{candidate === level ? <Check className="h-3.5 w-3.5 text-[#6d8438]" /> : null}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function MemberModelMenu({ connections, model, models, onChange }: {
  connections: ProviderConnectionRecord[];
  model?: ModelReference;
  models: EnabledModelRecord[];
  onChange: (model: ModelReference | undefined, definition?: EnabledModelRecord) => void;
}) {
  const { t } = usePreferences();
  const selected = models.find((candidate) => candidate.connectionId === model?.connectionId && candidate.modelId === model.modelId);
  const connection = connections.find((candidate) => candidate.id === model?.connectionId);
  return <DropdownMenu>
    <DropdownMenuTrigger className="inline-flex h-8 max-w-[180px] items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 text-[10px] font-medium text-[#555650] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring dark:text-foreground" title={t("expertsMemberModel")} type="button">{model ? <ProviderIcon avatarId={connection?.avatarId} className="h-3.5 w-3.5 shrink-0 object-contain" providerId={connection?.providerId ?? model.connectionId} /> : <img alt="" className="h-3.5 w-3.5 shrink-0 object-contain dark:invert" src={followComposerIcon} />}<span className="truncate">{selected?.displayName ?? model?.modelId ?? t("expertsFollowComposer")}</span><ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-h-[300px] w-[270px] overflow-y-auto p-1.5" onCloseAutoFocus={(event) => event.preventDefault()} side="top" sideOffset={6}>
      <DropdownMenuItem className="min-h-9 gap-2 text-[11px]" onSelect={() => onChange(undefined)}><img alt="" className="h-4 w-4 shrink-0 object-contain dark:invert" src={followComposerIcon} /><span className="min-w-0 flex-1 truncate">{t("expertsFollowComposer")}</span>{model === undefined ? <Check className="h-3.5 w-3.5 text-[#6d8438]" /> : null}</DropdownMenuItem>
      {models.map((candidate) => {
        const candidateConnection = connections.find((item) => item.id === candidate.connectionId);
        const active = candidate.connectionId === model?.connectionId && candidate.modelId === model.modelId;
        return <DropdownMenuItem className="min-h-9 gap-2 text-[11px]" key={`${candidate.connectionId}:${candidate.modelId}`} onSelect={() => onChange({ connectionId: candidate.connectionId, modelId: candidate.modelId }, candidate)}><ProviderIcon avatarId={candidateConnection?.avatarId} className="h-4 w-4 shrink-0 object-contain" providerId={candidateConnection?.providerId ?? candidate.connectionId} /><span className="min-w-0 flex-1 truncate">{candidate.displayName}</span>{active ? <Check className="h-3.5 w-3.5 text-[#6d8438]" /> : null}</DropdownMenuItem>;
      })}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function TeamEditor({ connections, connectors, experts, initial, models, onClose, onSave, skills }: {
  connections: ProviderConnectionRecord[];
  connectors: ConnectorSummary[];
  experts: ExpertDefinition[];
  initial?: ExpertTeamDefinition;
  models: EnabledModelRecord[];
  onClose: () => void;
  onSave: (input: ExpertTeamDefinitionInput) => Promise<void>;
  skills: SkillSummary[];
}) {
  const { t } = usePreferences();
  const initialMembers = initial?.members.map((member) => structuredClone(member)) ?? [newTeamMember()];
  const [activeTab, setActiveTab] = useState<"team" | "members">("team");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "");
  const [portraitOptions, setPortraitOptions] = useState(() =>
    initial?.portrait.kind === "avataaars"
      ? { ...initial.portrait.options }
      : { ...DEFAULT_AVATAAARS_OPTIONS },
  );
  const [members, setMembers] = useState<ExpertTeamMemberDefinition[]>(initialMembers);
  const [leaderMemberId, setLeaderMemberId] = useState(initial?.leaderMemberId ?? initialMembers[0]!.id);
  const [selectedMemberId, setSelectedMemberId] = useState(initialMembers[0]!.id);
  const [portraitMemberId, setPortraitMemberId] = useState<string | null>(null);
  const [portraitEditorOpen, setPortraitEditorOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const memberPromptRef = useRef<InlineSkillComposerHandle>(null);
  const selectedMember = members.find((member) => member.id === selectedMemberId) ?? members[0];
  const executionProfiles = ["read-only", "review", "research", "workspace-write"] as const;
  const availableModels = useMemo(() => models.filter((model) =>
    model.capabilities.supportsToolUse !== false &&
    connections.some((connection) => connection.id === model.connectionId && connection.authStatus === "configured")
  ), [connections, models]);

  useEffect(() => {
    if (!selectedMember) return;
    const timer = window.setTimeout(() => {
      const skillParts = selectedMember.skillIds.flatMap((skillId) => {
        const skill = skills.find((candidate) => candidate.id === skillId);
        return skill ? [{ type: "skill-reference" as const, skillId, name: skill.name, source: skill.source }] : [];
      });
      memberPromptRef.current?.setValue([...skillParts, { type: "text", text: selectedMember.systemPrompt }]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedMemberId, skills]);

  const updateMember = (id: string, changes: Partial<ExpertTeamMemberDefinition>) => {
    setMembers((current) => current.map((member) => member.id === id ? { ...member, ...changes, needsReview: undefined } : member));
  };
  const addMember = (member = newTeamMember(members.length)) => {
    if (members.length >= 9) return;
    setMembers((current) => [...current, member]);
    setSelectedMemberId(member.id);
    setActiveTab("members");
  };
  const importExpert = (expertId: string) => {
    const expert = experts.find((candidate) => candidate.id === expertId);
    if (!expert) return;
    addMember({
      id: crypto.randomUUID(),
      name: expert.name,
      portrait: structuredClone(expert.portrait),
      systemPrompt: expert.systemPrompt,
      skillIds: [...expert.skillIds],
      connectorIds: [...expert.connectorIds],
      executionProfile: members.length === 0 ? "workspace-write" : "read-only",
      responsibility: expert.description,
    });
  };
  const removeMember = (id: string) => {
    const next = members.filter((member) => member.id !== id);
    if (!next.length) return;
    setMembers(next);
    if (leaderMemberId === id) setLeaderMemberId(next[0]!.id);
    if (selectedMemberId === id) setSelectedMemberId(next[0]!.id);
  };

  return <div className="fixed inset-0 z-[120] grid place-items-center bg-black/25 p-5">
    <form className="flex h-[540px] max-h-[calc(100vh-40px)] w-full max-w-[880px] flex-col overflow-hidden rounded-[8px] border border-[#deded8] bg-white shadow-[0_20px_60px_rgba(0,0,0,.22)] dark:border-border dark:bg-card" onSubmit={(event) => {
      event.preventDefault();
      setError(null);
      if (!name.trim() || !description.trim() || !systemPrompt.trim()) {
        setActiveTab("team");
        setError(t("expertsTeamFieldsRequired"));
        return;
      }
      if (members.length < 2) {
        setActiveTab("members");
        setError(t("expertsMembersRequired"));
        return;
      }
      const incomplete = members.find((member) => !member.name.trim() || !member.responsibility.trim() || !member.systemPrompt.trim());
      if (incomplete) {
        setActiveTab("members");
        setSelectedMemberId(incomplete.id);
        setError(t("expertsMemberFieldsRequired"));
        return;
      }
      setSaving(true);
      void onSave({
        name,
        description,
        systemPrompt,
        portrait: { kind: "avataaars", schemaVersion: 1, options: portraitOptions },
        leaderMemberId,
        members,
      })
        .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setSaving(false));
    }}>
      <header className="flex h-12 shrink-0 items-center border-b border-[#e8e8e2] px-4 dark:border-border">
        <h2 className="text-[14px] font-semibold">{t(initial ? "expertsEditTeam" : "expertsCreateTeam")}</h2>
        <nav className="ml-8 flex h-full items-end gap-5" aria-label={t("expertsCreateTeam")}>
          <button className={`h-9 border-b-2 px-1 text-[11px] font-semibold ${activeTab === "team" ? "border-[#596b35] text-[#3f4c27]" : "border-transparent text-[#8a8b84]"}`} onClick={() => setActiveTab("team")} type="button">{t("expertsTeamInformation")}</button>
          <button className={`h-9 border-b-2 px-1 text-[11px] font-semibold ${activeTab === "members" ? "border-[#596b35] text-[#3f4c27]" : "border-transparent text-[#8a8b84]"}`} onClick={() => setActiveTab("members")} type="button">{t("expertsMembers")} <span className="font-mono text-[9px]">{members.length}/9</span></button>
        </nav>
        <button className="ml-auto grid h-7 w-7 place-items-center rounded-[5px] text-[#777770] hover:bg-muted" onClick={onClose} type="button"><X className="h-4 w-4" /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "team" ? <div className="h-full overflow-y-auto px-5 py-5">
          <div className="grid grid-cols-[minmax(0,1fr)_74px] gap-5">
            <label className="text-[11px] font-semibold text-[#62625b]">{t("expertsName")}<input className="mt-1.5 h-9 w-full rounded-[6px] border border-[#deded8] px-3 text-[12px] outline-none focus:border-[#9bad70] dark:border-border dark:bg-muted" maxLength={80} onChange={(event) => setName(event.target.value)} value={name} /></label>
            <div><p className="text-[11px] font-semibold text-[#62625b]">{t("expertsTeamPortrait")}</p><button aria-label={t("expertsEditPortrait")} className="group relative mt-1.5 grid h-9 w-9 place-items-center rounded-full border border-[#d6d7d0] p-0.5 outline-none hover:border-[#91a365] focus-visible:ring-2 focus-visible:ring-[#91a365] focus-visible:ring-offset-2 dark:border-border dark:focus-visible:ring-offset-card" onClick={() => setPortraitEditorOpen(true)} title={t("expertsEditPortrait")} type="button"><ExpertPortrait className="h-full w-full" name={name || t("expertsTeams")} portrait={{ kind: "avataaars", schemaVersion: 1, options: portraitOptions }} /><span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-[#596b35] text-white"><Pencil className="h-2 w-2" /></span></button></div>
          </div>
          <label className="mt-5 block text-[11px] font-semibold text-[#62625b]">{t("expertsDescription")}<textarea className="mt-1.5 min-h-20 w-full resize-y rounded-[6px] border border-[#deded8] px-3 py-2 text-[12px] leading-5 outline-none focus:border-[#9bad70] dark:border-border dark:bg-muted" maxLength={500} onChange={(event) => setDescription(event.target.value)} value={description} /></label>
          <label className="mt-5 block text-[11px] font-semibold text-[#62625b]">{t("expertsTeamInstructions")}<textarea className="mt-1.5 min-h-44 w-full resize-y rounded-[6px] border border-[#deded8] px-3 py-2 text-[12px] leading-5 outline-none focus:border-[#9bad70] dark:border-border dark:bg-muted" maxLength={30000} onChange={(event) => setSystemPrompt(event.target.value)} value={systemPrompt} /></label>
        </div> : <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[180px_minmax(0,1fr)] sm:grid-cols-[240px_minmax(0,1fr)] sm:grid-rows-1">
          <aside className="flex min-h-0 flex-col border-b border-[#e8e8e2] bg-[#fafaf8] dark:border-border dark:bg-muted/30 sm:border-b-0 sm:border-r">
            <div className="flex items-center gap-1.5 border-b border-[#e8e8e2] p-2.5 dark:border-border">
              <button aria-label={t("expertsAddMember")} className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] border border-[#dfe4d2] bg-white text-[#596b35] hover:bg-[#f4f6ee] dark:border-border dark:bg-card" disabled={members.length >= 9} onClick={() => addMember()} title={t("expertsAddMember")} type="button"><Plus className="h-3.5 w-3.5" /></button>
              <select aria-label={t("expertsCopyEmployee")} className="h-8 min-w-0 flex-1 rounded-[6px] border border-[#deded8] bg-white px-2 text-[10px] text-[#62635c] outline-none dark:border-border dark:bg-card" disabled={!experts.length || members.length >= 9} onChange={(event) => { if (event.target.value) importExpert(event.target.value); event.target.value = ""; }} defaultValue=""><option value="">{t("expertsCopyEmployee")}</option>{experts.map((expert) => <option key={expert.id} value={expert.id}>{expert.name}</option>)}</select>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {members.map((member) => {
                const active = member.id === selectedMember?.id;
                const lead = member.id === leaderMemberId;
                const incomplete = !member.name.trim() || !member.responsibility.trim() || !member.systemPrompt.trim();
                return <div className={`group mb-1 flex items-center gap-2 rounded-[6px] border px-2 py-2 ${active ? "border-[#b8c88d] bg-white shadow-sm dark:bg-card" : "border-transparent hover:bg-white/70 dark:hover:bg-card/60"}`} key={member.id}>
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setSelectedMemberId(member.id)} type="button"><ExpertPortrait className="h-8 w-8 shrink-0" name={member.name || t("expertsMembers")} portrait={member.portrait} /><span className="min-w-0"><span className="block truncate text-[11px] font-semibold text-[#41423d] dark:text-foreground">{member.name || t("expertsUnnamedMember")}</span><span className={`mt-0.5 block text-[9px] ${incomplete ? "text-[#a56c4c]" : "text-[#8a8b84]"}`}>{incomplete ? t("expertsMemberIncomplete") : executionProfileLabel(member.executionProfile, t)}</span></span></button>
                  {lead ? <span className="shrink-0 whitespace-nowrap text-[9px] font-semibold text-[#64783c]">{t("expertsTeamLead")}</span> : null}
                  {!lead ? <DropdownMenu>
                    <DropdownMenuTrigger aria-label={t("expertsMemberActions")} className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-[4px] text-[#8d8e87] opacity-0 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100" title={t("expertsMemberActions")} type="button"><MoreHorizontal className="h-3.5 w-3.5" /></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[156px] p-1" onCloseAutoFocus={(event) => event.preventDefault()} side="top" sideOffset={5}>
                      <DropdownMenuItem className="min-h-8 gap-1.5 text-[11px]" onSelect={() => { setLeaderMemberId(member.id); updateMember(member.id, { executionProfile: "workspace-write" }); }}><Crown className="h-3 w-3 text-[#7d914c]" />{t("expertsSetTeamLead")}</DropdownMenuItem>
                      <DropdownMenuItem className="min-h-8 gap-1.5 text-[11px] text-[#a36e60] focus:text-[#a36e60]" disabled={members.length === 1} onSelect={() => removeMember(member.id)}><Trash2 className="h-3 w-3" />{t("expertsRemoveMember")}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu> : null}
                </div>;
              })}
            </div>
          </aside>

          {selectedMember ? <section className="flex h-full min-h-0 flex-col overflow-hidden px-5 py-4">
            <div className="shrink-0 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_74px_150px]">
              <label className="text-[11px] font-semibold text-[#62625b]">{t("expertsName")}<input className="mt-1.5 h-9 w-full rounded-[6px] border border-[#deded8] px-3 text-[12px] outline-none focus:border-[#9bad70] dark:border-border dark:bg-muted" maxLength={80} onChange={(event) => updateMember(selectedMember.id, { name: event.target.value })} value={selectedMember.name} /></label>
              <div><p className="text-[11px] font-semibold text-[#62625b]">{t("expertsEmployeePortrait")}</p><button className="group relative mt-1.5 grid h-9 w-9 place-items-center rounded-full border border-[#d6d7d0] p-0.5" onClick={() => setPortraitMemberId(selectedMember.id)} type="button"><ExpertPortrait className="h-full w-full" name={selectedMember.name || t("expertsMembers")} portrait={selectedMember.portrait} /><span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-[#596b35] text-white"><Pencil className="h-2 w-2" /></span></button></div>
              {selectedMember.id === leaderMemberId ? <div><p className="text-[11px] font-semibold text-[#62625b]">{t("expertsExecutionProfile")}</p><div className="mt-1.5 flex h-9 items-center rounded-[6px] bg-[#edf2df] px-2 text-[10px] font-medium text-[#5f7139]">{t("expertsTeamLead")}</div></div> : <label className="text-[11px] font-semibold text-[#62625b]">{t("expertsExecutionProfile")}<select className="mt-1.5 h-9 w-full rounded-[6px] border border-[#deded8] bg-white px-2 text-[10px] dark:border-border dark:bg-muted" onChange={(event) => updateMember(selectedMember.id, { executionProfile: event.target.value as ExpertExecutionProfile })} value={selectedMember.executionProfile}>{executionProfiles.map((profile) => <option key={profile} value={profile}>{executionProfileLabel(profile, t)}</option>)}</select></label>}
            </div>
            <label className="mt-4 block shrink-0 text-[11px] font-semibold text-[#62625b]">{t("expertsMemberResponsibility")}<textarea className="mt-1.5 min-h-16 w-full resize-y rounded-[6px] border border-[#deded8] px-3 py-2 text-[12px] leading-5 outline-none focus:border-[#9bad70] dark:border-border dark:bg-muted" maxLength={1000} onChange={(event) => updateMember(selectedMember.id, { responsibility: event.target.value })} value={selectedMember.responsibility} /></label>
            <div className="mt-4 flex min-h-0 flex-1 flex-col"><p className="shrink-0 text-[11px] font-semibold text-[#62625b]">{t("expertsEmployeeInstructions")}</p><div className="mt-1.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[7px] border border-[#deded8] bg-[#fafaf8] focus-within:border-[#9bad70] dark:border-border dark:bg-muted"><InlineSkillComposer ariaLabel={t("expertsEmployeeInstructions")} className="min-h-0 w-full flex-1 overflow-y-auto bg-transparent px-3 py-2 text-[15px] font-medium leading-6 text-[#353532] outline-none dark:text-foreground" onChange={(value) => updateMember(selectedMember.id, { systemPrompt: value.text, skillIds: value.skillIds })} onSubmit={() => undefined} placeholder={t("expertsEmployeeInstructionsPlaceholder")} placeholderClassName="left-3 top-2 text-[14px] font-normal leading-6" ref={memberPromptRef} /><div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1 border-t border-[#deded8] px-2 py-1.5 dark:border-border"><SkillInsertMenu label="Skills" onSelect={(skill) => { memberPromptRef.current?.insertSkill(skill); window.setTimeout(() => memberPromptRef.current?.focus(), 0); }} skills={skills} /><ConnectorSwitchMenu connectors={connectors} label="MCP" onChange={(connectorIds) => updateMember(selectedMember.id, { connectorIds })} selected={selectedMember.connectorIds} side="top" />{selectedMember.id !== leaderMemberId ? <div className="ml-auto flex min-w-0 items-center gap-0.5"><MemberThinkingMenu level={selectedMember.thinkingLevel} model={availableModels.find((model) => model.connectionId === selectedMember.model?.connectionId && model.modelId === selectedMember.model.modelId)} onChange={(thinkingLevel) => updateMember(selectedMember.id, { thinkingLevel })} /><MemberModelMenu connections={connections} model={selectedMember.model} models={availableModels} onChange={(model, definition) => updateMember(selectedMember.id, { model, thinkingLevel: definition ? clampMemberThinkingLevel(definition, selectedMember.thinkingLevel) : selectedMember.thinkingLevel })} /></div> : null}</div></div></div>
          </section> : null}
        </div>}
      </div>

      <footer className="flex min-h-12 shrink-0 items-center border-t border-[#e8e8e2] px-4 py-2 dark:border-border">
        {error ? <p className="mr-4 text-[10px] text-destructive">{error}</p> : <p className="mr-4 hidden text-[10px] text-[#8a8b84] sm:block">{t("expertsTeamMemberHint")}</p>}
        <div className="ml-auto flex gap-2"><button className="h-8 rounded-[6px] px-3 text-[11px] text-[#66665f] hover:bg-[#f2f2ee]" onClick={onClose} type="button">{t("expertsCancel")}</button><button className="h-8 rounded-[6px] bg-[#596b35] px-4 text-[11px] font-semibold text-white hover:bg-[#4b5c2b] disabled:opacity-50" disabled={saving} type="submit">{saving ? t("expertsSaving") : t(initial ? "expertsSaveTeam" : "expertsCreateTeam")}</button></div>
      </footer>
    </form>
    {portraitEditorOpen ? <PortraitEditor initial={portraitOptions} name={name || t("expertsTeams")} onApply={(options) => { setPortraitOptions(options); setPortraitEditorOpen(false); }} onClose={() => setPortraitEditorOpen(false)} /> : null}
    {portraitMemberId && selectedMember ? <PortraitEditor initial={selectedMember.portrait.kind === "avataaars" ? selectedMember.portrait.options : DEFAULT_AVATAAARS_OPTIONS} name={selectedMember.name || t("expertsMembers")} onApply={(options) => { updateMember(portraitMemberId, { portrait: { kind: "avataaars", schemaVersion: 1, options } }); setPortraitMemberId(null); }} onClose={() => setPortraitMemberId(null)} /> : null}
  </div>;
}

function ExpertEditor({
  connectors,
  initial,
  onClose,
  onSave,
  skills,
}: {
  connectors: ConnectorSummary[];
  initial?: ExpertDefinition;
  onClose: () => void;
  onSave: (input: ExpertDefinitionInput) => Promise<void>;
  skills: SkillSummary[];
}) {
  const { t } = usePreferences();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [portraitOptions, setPortraitOptions] = useState(() =>
    initial?.portrait.kind === "avataaars"
      ? { ...initial.portrait.options }
      : { ...DEFAULT_AVATAAARS_OPTIONS },
  );
  const [portraitEditorOpen, setPortraitEditorOpen] = useState(false);
  const [connectorIds, setConnectorIds] = useState<string[]>(initial?.connectorIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const promptRef = useRef<InlineSkillComposerHandle>(null);
  const promptValueRef = useRef<InlineSkillComposerValue>(
    EMPTY_EXPERT_PROMPT_VALUE,
  );
  useEffect(() => {
    if (!initial) return;
    const timer = window.setTimeout(() => {
      const skillParts = initial.skillIds.flatMap((skillId) => {
        const skill = skills.find((candidate) => candidate.id === skillId);
        return skill
          ? [{ type: "skill-reference" as const, skillId, name: skill.name, source: skill.source }]
          : [];
      });
      promptRef.current?.setValue([
        ...skillParts,
        { type: "text", text: initial.systemPrompt },
      ]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initial, skills]);
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/25 p-5">
      <form
        className="flex max-h-[86vh] w-full max-w-[620px] flex-col overflow-hidden rounded-[8px] border border-[#deded8] bg-white shadow-[0_20px_60px_rgba(0,0,0,.22)] dark:border-border dark:bg-card"
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          setError(null);
          void onSave({
            name,
            description,
            systemPrompt: promptValueRef.current.text,
            portrait: {
              kind: "avataaars",
              schemaVersion: 1,
              options: portraitOptions,
            },
            skillIds: promptValueRef.current.skillIds,
            connectorIds,
          })
            .catch((cause) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
            .finally(() => setSaving(false));
        }}
      >
        <header className="flex h-12 items-center border-b border-[#e8e8e2] px-4 dark:border-border">
          <h2 className="text-[14px] font-semibold">{t(initial ? "expertsEditEmployee" : "expertsCreateEmployee")}</h2>
          <button
            className="ml-auto grid h-7 w-7 place-items-center text-[#777770]"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-4 py-4">
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-4">
            <label className="text-[11px] font-semibold text-[#62625b]">
              {t("expertsName")}
              <input
                className="mt-1.5 h-9 w-full rounded-[6px] border border-[#deded8] px-3 text-[12px] outline-none focus:border-[#9bad70] dark:border-border dark:bg-muted"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>
            <div>
              <p className="text-[11px] font-semibold text-[#62625b]">
                {t("expertsEmployeePortrait")}
              </p>
              <button
                aria-label={t("expertsEditPortrait")}
                className="group relative mt-1.5 grid h-14 w-14 place-items-center rounded-full border border-[#d6d7d0] bg-[#fafaf8] p-0.5 shadow-[0_2px_8px_rgba(35,36,31,.08)] transition-[border-color,box-shadow,transform] hover:scale-[1.03] hover:border-[#91a365] hover:shadow-[0_4px_14px_rgba(65,77,43,.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#91a365] focus-visible:ring-offset-2 dark:border-border dark:bg-muted dark:focus-visible:ring-offset-card"
                onClick={() => setPortraitEditorOpen(true)}
                title={t("expertsEditPortrait")}
                type="button"
              >
                <ExpertPortrait
                  className="h-full w-full"
                  name={name || t("expertsEmployees")}
                  portrait={{ kind: "avataaars", schemaVersion: 1, options: portraitOptions }}
                />
                <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-[#596b35] text-white shadow-sm transition-colors group-hover:bg-[#4b5c2b] dark:border-card">
                  <Pencil className="h-2.5 w-2.5" />
                </span>
              </button>
            </div>
          </div>
          <label className="mt-4 block text-[11px] font-semibold text-[#62625b]">
            {t("expertsDescription")}
            <textarea
              className="mt-1.5 min-h-16 w-full resize-y rounded-[6px] border border-[#deded8] px-3 py-2 text-[12px] leading-5 outline-none focus:border-[#9bad70] dark:border-border dark:bg-muted"
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
              required
              value={description}
            />
          </label>
          <div className="mt-4">
            <p className="text-[11px] font-semibold text-[#62625b]">{t("expertsEmployeeInstructions")}</p>
            <div className="mt-1.5 overflow-hidden rounded-[7px] border border-[#deded8] bg-[#fafaf8] shadow-[0_1px_2px_rgba(0,0,0,.025)] focus-within:border-[#9bad70] dark:border-border dark:bg-muted">
              <InlineSkillComposer
                ariaLabel={t("expertsEmployeeInstructions")}
                className="h-40 min-h-40 max-h-40 w-full overflow-y-auto bg-transparent px-3 py-2 text-[16px] font-medium leading-7 text-[#353532] caret-[#252624] outline-none selection:bg-[#dff09b] dark:text-foreground dark:caret-foreground dark:selection:bg-[#4a5a26]"
                onChange={(value) => {
                  promptValueRef.current = value;
                }}
                onSubmit={() => formRef.current?.requestSubmit()}
                placeholder={t("expertsEmployeeInstructionsPlaceholder")}
                placeholderClassName="left-3 top-2 text-[16px] font-normal leading-7"
                ref={promptRef}
              />
              <div className="flex min-h-11 flex-wrap items-center gap-1 border-t border-[#deded8] px-2 py-1.5 dark:border-border">
                <SkillInsertMenu
                  label="Skills"
                  onSelect={(skill) => {
                    promptRef.current?.insertSkill(skill);
                    window.setTimeout(() => promptRef.current?.focus(), 0);
                  }}
                  skills={skills}
                />
                <ConnectorSwitchMenu
                  connectors={connectors}
                  label="MCP"
                  onChange={setConnectorIds}
                  selected={connectorIds}
                  side="top"
                />
              </div>
            </div>
          </div>
          {error ? (
            <p className="mt-3 text-[11px] text-destructive">{error}</p>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-[#e8e8e2] px-4 py-3 dark:border-border">
          <button
            className="h-8 rounded-[6px] px-3 text-[11px] text-[#66665f] hover:bg-[#f2f2ee]"
            onClick={onClose}
            type="button"
          >
            {t("expertsCancel")}
          </button>
          <button
            className="h-8 rounded-[6px] bg-[#596b35] px-4 text-[11px] font-semibold text-white hover:bg-[#4b5c2b] disabled:opacity-50"
            disabled={saving}
            type="submit"
          >
            {saving ? t("expertsSaving") : t(initial ? "expertsSaveEmployee" : "expertsCreateEmployee")}
          </button>
        </footer>
      </form>
      {portraitEditorOpen ? (
        <PortraitEditor
          initial={portraitOptions}
          name={name || t("expertsEmployees")}
          onApply={(options) => {
            setPortraitOptions(options);
            setPortraitEditorOpen(false);
          }}
          onClose={() => setPortraitEditorOpen(false)}
        />
      ) : null}
    </div>
  );
}

function ExpertSection({
  experts,
  label,
  onSummon,
}: {
  experts: NonNullable<ReturnType<typeof useRuntime>["snapshot"]>["experts"];
  label: string;
  onSummon: (selection: ExpertSelection) => void;
}) {
  const { t } = usePreferences();
  return (
    <section className="pt-7">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-[#44443f] dark:text-foreground">
          {label}
        </h2>
        <span className="font-mono text-[9px] text-[#9a9a92]">
          {experts.length}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {experts.map((expert) => (
          <article
            className="group flex min-h-[104px] items-center gap-3 border-y border-[#e8e8e2] bg-white/65 px-3 py-3 transition-colors hover:bg-white dark:border-border dark:bg-card/70"
            key={expert.id}
          >
            <ExpertPortrait
              className="h-12 w-12"
              name={expert.name}
              portrait={expert.portrait}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-[13px] font-semibold text-[#393934] dark:text-foreground">
                  {expert.name}
                </h3>
                {expert.kind === "team" ? (
                  <UsersRound className="h-3.5 w-3.5 text-[#75844e]" />
                ) : null}
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[#777770] dark:text-muted-foreground">
                {expert.description}
              </p>
              <p className="mt-1 font-mono text-[9px] text-[#9a9a91]">
                {expert.kind === "team"
                  ? `${expert.memberCount ?? 0} ${t("expertsMembers")}`
                  : t("expertsGeneralWork")}
              </p>
            </div>
            <button
              aria-label={`${t("expertsSummon")} ${expert.name}`}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] text-[#707a51] opacity-70 hover:bg-[#edf2e3] hover:opacity-100"
              onClick={() =>
                onSummon({
                  kind: expert.kind,
                  id: expert.id,
                  version: expert.version,
                })
              }
              title={t("expertsSummon")}
              type="button"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
