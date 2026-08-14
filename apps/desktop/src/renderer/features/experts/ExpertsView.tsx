import {
  ArrowRight,
  ClipboardList,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ConnectorSummary,
  ExpertDefinition,
  ExpertDefinitionInput,
  ExpertExecutionProfile,
  ExpertPortrait as ExpertPortraitValue,
  ExpertSelection,
  ExpertTeamDefinitionInput,
  ExpertTeamDetail,
  ExpertSummary,
  SkillSummary,
} from "@wordless/domain";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { ExpertPortrait } from "./ExpertPortrait";
import { PortraitEditor } from "./PortraitEditor";
import { DEFAULT_AVATAAARS_OPTIONS } from "./avataaars-portrait";
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
            selected.kind === "expert" && selected.source === "local"
              ? () => {
                  void client.listExperts().then((experts) => {
                    const expert = experts.find((item) => item.id === selected.id);
                    if (!expert) return;
                    setEditingExpert(expert);
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
      {creating === "team" && snapshot ? (
        <TeamEditor
          experts={snapshot.experts.filter(
            (expert) => expert.kind === "expert",
          )}
          onClose={() => setCreating(null)}
          onSave={async (input) => {
            await client.saveExpertTeam(input);
            await refresh();
            setCreating(null);
          }}
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
        className="flex max-h-[calc(100vh-96px)] w-full max-w-[640px] flex-col overflow-hidden rounded-[8px] bg-white p-5 shadow-[0_24px_60px_rgba(0,0,0,.22)] dark:bg-card"
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
                  className="shrink-0 whitespace-nowrap rounded-[6px] bg-black px-3 py-1.5 text-[11px] font-semibold text-white"
                  onClick={() => onSummon()}
                  type="button"
                >
                  {t("expertsSummon")}
                </button>
                {onEdit ? (
                  <button
                    aria-label={t("expertsEditEmployee")}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] border border-[#deded8] text-[#666760] hover:bg-muted dark:border-border"
                    onClick={onEdit}
                    title={t("expertsEditEmployee")}
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
                      className="flex w-full items-start gap-2.5 rounded-[7px] bg-[#f5f5f3] px-3.5 py-3 text-left text-[12px] leading-5 text-[#575850] transition-colors hover:bg-[#eceee5] dark:bg-muted"
                      key={prompt}
                      onClick={() => onSummon(prompt)}
                      type="button"
                    >
                      <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#73834d]" />
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

function TeamEditor({
  experts,
  onClose,
  onSave,
}: {
  experts: { id: string; name: string; portrait: ExpertPortraitValue }[];
  onClose: () => void;
  onSave: (input: ExpertTeamDefinitionInput) => Promise<void>;
}) {
  const { t } = usePreferences();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [leaderExpertId, setLeaderExpertId] = useState(experts[0]?.id ?? "");
  const [portraitKey, setPortraitKey] = useState("product-strategist");
  const [members, setMembers] = useState<
    {
      expertId: string;
      executionProfile: ExpertExecutionProfile;
      responsibility: string;
    }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const executionProfiles = [
    "read-only",
    "review",
    "research",
    "workspace-write",
  ] as const;
  const collaboratorExperts = experts.filter(
    (expert) => expert.id !== leaderExpertId,
  );
  const add = () => {
    if (members.length < 8 && collaboratorExperts.length > 0)
      setMembers((current) => [
        ...current,
        {
          expertId: collaboratorExperts[0]?.id ?? "",
          executionProfile:
            executionProfiles[current.length % executionProfiles.length]!,
          responsibility: "",
        },
      ]);
  };
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/25 p-5">
      <form
        className="flex max-h-[86vh] w-full max-w-[620px] flex-col overflow-hidden rounded-[8px] border border-[#deded8] bg-white shadow-[0_20px_60px_rgba(0,0,0,.22)] dark:border-border dark:bg-card"
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          void onSave({
            name,
            description,
            systemPrompt,
            portraitKey,
            leaderExpertId,
            members,
          })
            .catch((cause) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
            .finally(() => setSaving(false));
        }}
      >
        <header className="flex h-12 items-center border-b border-[#e8e8e2] px-4">
          <h2 className="text-[14px] font-semibold">{t("expertsCreateTeam")}</h2>
          <button
            className="ml-auto grid h-7 w-7 place-items-center text-[#777770]"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-4 py-4">
          <div className="grid grid-cols-[1fr_190px] gap-4">
            <label className="text-[11px] font-semibold text-[#62625b]">
              {t("expertsName")}
              <input
                className="mt-1.5 h-9 w-full rounded-[6px] border border-[#deded8] px-3 text-[12px] outline-none dark:border-border dark:bg-muted"
                onChange={(e) => setName(e.target.value)}
                required
                value={name}
              />
            </label>
            <div>
              <p className="text-[11px] font-semibold text-[#62625b]">
                {t("expertsTeamPortrait")}
              </p>
              <div className="mt-1.5 flex gap-2">
                {[
                  "research-analyst",
                  "product-strategist",
                  "content-studio",
                ].map((key) => (
                  <button
                    className={`rounded-full ${portraitKey === key ? "ring-2 ring-[#8da45d] ring-offset-2" : "opacity-65"}`}
                    key={key}
                    onClick={() => setPortraitKey(key)}
                    type="button"
                  >
                    <ExpertPortrait
                      className="h-8 w-8"
                      name={name || t("expertsTeams")}
                      portrait={{ kind: "builtin", key }}
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <label className="mt-4 block text-[11px] font-semibold text-[#62625b]">
            {t("expertsDescription")}
            <textarea
              className="mt-1.5 min-h-14 w-full resize-y rounded-[6px] border border-[#deded8] px-3 py-2 text-[12px] outline-none dark:border-border dark:bg-muted"
              onChange={(e) => setDescription(e.target.value)}
              required
              value={description}
            />
          </label>
          <label className="mt-4 block text-[11px] font-semibold text-[#62625b]">
            {t("expertsTeamInstructions")}
            <textarea
              className="mt-1.5 min-h-24 w-full resize-y rounded-[6px] border border-[#deded8] px-3 py-2 font-mono text-[11px] outline-none dark:border-border dark:bg-muted"
              onChange={(e) => setSystemPrompt(e.target.value)}
              required
              value={systemPrompt}
            />
          </label>
          <label className="mt-4 block text-[11px] font-semibold text-[#62625b]">
            {t("expertsTeamLeadLabel")}
            <select
              className="mt-1.5 h-8 w-full rounded-[6px] border border-[#deded8] px-2 text-[11px] dark:border-border dark:bg-muted"
              onChange={(e) => {
                const nextLeaderId = e.target.value;
                setLeaderExpertId(nextLeaderId);
                setMembers((current) =>
                  current.filter((member) => member.expertId !== nextLeaderId),
                );
              }}
              value={leaderExpertId}
            >
              {experts.map((expert) => (
                <option key={expert.id} value={expert.id}>
                  {expert.name}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-[#62625b]">
                {t("expertsCollaborators")}{" "}
                <span className="font-mono text-[9px] text-[#999990]">
                  {members.length}/8
                </span>
              </p>
              <button
                className="h-7 rounded-[5px] border border-[#dfe4d2] px-2 text-[10px] text-[#596b35]"
                disabled={
                  collaboratorExperts.length === 0 || members.length >= 8
                }
                onClick={add}
                type="button"
              >
                {t("expertsAddMember")}
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {members.map((member, index) => (
                <div
                  className="grid grid-cols-[1fr_108px] gap-2 rounded-[6px] bg-[#f7f8f3] p-2 dark:bg-muted"
                  key={`${index}-${member.expertId}`}
                >
                  <select
                    className="h-7 rounded border border-[#dfe1d9] bg-white px-1 text-[10px] dark:bg-card"
                    onChange={(e) =>
                      setMembers((current) =>
                        current.map((item, i) =>
                          i === index
                            ? { ...item, expertId: e.target.value }
                            : item,
                        ),
                      )
                    }
                    value={member.expertId}
                  >
                    {collaboratorExperts.map((expert) => (
                      <option key={expert.id} value={expert.id}>
                        {expert.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="h-7 rounded border border-[#dfe1d9] bg-white px-1 text-[10px] dark:bg-card"
                    onChange={(e) =>
                      setMembers((current) =>
                        current.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                executionProfile: e.target
                                  .value as ExpertExecutionProfile,
                              }
                            : item,
                        ),
                      )
                    }
                    aria-label={t("expertsExecutionProfile")}
                    title={t("expertsExecutionProfile")}
                    value={member.executionProfile}
                  >
                    {executionProfiles.map((profile) => (
                      <option key={profile} value={profile}>
                        {executionProfileLabel(profile, t)}
                      </option>
                    ))}
                  </select>
                  <input
                    className="col-span-2 h-7 rounded border border-[#dfe1d9] bg-white px-2 text-[10px] dark:bg-card"
                    placeholder={t("expertsMemberResponsibility")}
                    onChange={(e) =>
                      setMembers((current) =>
                        current.map((item, i) =>
                          i === index
                            ? { ...item, responsibility: e.target.value }
                            : item,
                        ),
                      )
                    }
                    required
                    value={member.responsibility}
                  />
                </div>
              ))}
            </div>
          </div>
          {error ? (
            <p className="mt-3 text-[11px] text-destructive">{error}</p>
          ) : null}
          {members.length === 0 ? (
            <p className="mt-3 text-[10px] text-[#8a7450]">
              {t("expertsMembersRequired")}
            </p>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-[#e8e8e2] px-4 py-3">
          <button
            className="h-8 rounded-[6px] px-3 text-[11px] text-[#66665f]"
            onClick={onClose}
            type="button"
          >
            {t("expertsCancel")}
          </button>
          <button
            className="h-8 rounded-[6px] bg-[#596b35] px-4 text-[11px] font-semibold text-white disabled:opacity-50"
            disabled={saving || members.length === 0}
            type="submit"
          >
            {saving ? t("expertsSaving") : t("expertsCreateTeam")}
          </button>
        </footer>
      </form>
    </div>
  );
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
          <div className="grid grid-cols-[1fr_190px] gap-4">
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
                className="mt-1.5 flex h-14 w-full items-center gap-2.5 rounded-[7px] border border-[#deded8] bg-[#fafaf8] px-2.5 text-left transition-colors hover:border-[#aab890] hover:bg-[#f5f7f0] dark:border-border dark:bg-muted"
                onClick={() => setPortraitEditorOpen(true)}
                type="button"
              >
                <ExpertPortrait
                  className="h-9 w-9"
                  name={name || t("expertsEmployees")}
                  portrait={{ kind: "avataaars", schemaVersion: 1, options: portraitOptions }}
                />
                <span className="min-w-0 flex-1 text-[11px] font-medium text-[#596b35]">{t("expertsEditPortrait")}</span>
                <Pencil className="h-3.5 w-3.5 shrink-0 text-[#788560]" />
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
            <div className="mt-1.5 rounded-[7px] border border-[#deded8] bg-[#fafaf8] shadow-[0_1px_2px_rgba(0,0,0,.025)] focus-within:border-[#9bad70] dark:border-border dark:bg-muted">
              <InlineSkillComposer
                ariaLabel={t("expertsEmployeeInstructions")}
                className="min-h-32 w-full resize-y overflow-y-auto bg-transparent px-3 py-2 text-[16px] font-medium leading-7 text-[#353532] caret-[#252624] outline-none selection:bg-[#dff09b] dark:text-foreground dark:caret-foreground dark:selection:bg-[#4a5a26]"
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
