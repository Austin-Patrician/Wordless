import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@wordless/ui-kit";
import type {
  SessionArtifactPreview,
  SessionArtifactsSnapshot,
  SessionGeneratedArtifact,
} from "@wordless/protocol";
import {
  ArrowLeft,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  Save,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileTypeIcon } from "../../shared/FileTypeIcon";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";
import { ExpertPortrait } from "../experts/ExpertPortrait";
import type { WorkbenchContextPanelProps } from "../workbench/context-panel-types";
import { DocumentPreview } from "./DocumentPreview";
import everydayOfficeIcon from "../../../icons/common-icons/日常办公.svg";
import emptyArtifactsIcon from "../../../icons/common-icons/数据空空如也.svg";

const EMPTY_SNAPSHOT: SessionArtifactsSnapshot = { revision: "", artifacts: [] };

function producerLabel(
  artifact: SessionGeneratedArtifact,
  locale: "zh-CN" | "en-US",
): string {
  if (artifact.producer.kind !== "primary" || artifact.producer.name === "General Work")
    return artifact.producer.name;
  return `${artifact.producer.name} · ${locale === "zh-CN" ? "团队负责人" : "Team Lead"}`;
}

function shouldShowProducer(artifact: SessionGeneratedArtifact): boolean {
  return artifact.producer.kind !== "primary" || Boolean(artifact.producer.id);
}

export function GeneralWorkArtifactsPanel({ sessionId }: WorkbenchContextPanelProps) {
  const client = useRuntimeClient();
  const { locale, t } = usePreferences();
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [selected, setSelected] = useState<SessionGeneratedArtifact | null>(null);
  const [preview, setPreview] = useState<SessionArtifactPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await client.getSessionArtifacts(sessionId);
      setSnapshot(next);
      setSelected((current) =>
        current
          ? next.artifacts.find((artifact) => artifact.id === current.id) ?? null
          : null,
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [client, sessionId]);

  useEffect(() => {
    setSnapshot(EMPTY_SNAPSHOT);
    setSelected(null);
    setPreview(null);
    setLoading(true);
    void refresh();
    return client.subscribe((event) => {
      if (event.sessionId !== sessionId) return;
      if (
        event.event.type === "session.artifacts.changed" ||
        event.event.type === "session.idle"
      )
        void refresh();
    });
  }, [client, refresh, sessionId]);

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    let active = true;
    setPreview(null);
    void client
      .readSessionArtifact(sessionId, selected.id)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [client, selected, sessionId]);

  const action = async (
    artifact: SessionGeneratedArtifact,
    type: "open" | "reveal" | "save",
  ) => {
    try {
      if (type === "open") await client.openSessionArtifact(sessionId, artifact.id);
      if (type === "reveal") await client.revealSessionArtifact(sessionId, artifact.id);
      if (type === "save") await client.saveSessionArtifactAs(sessionId, artifact.id);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const groups = useMemo(() => {
    const sections = new Map<string, SessionGeneratedArtifact[]>();
    for (const artifact of snapshot.artifacts) {
      const list = sections.get(artifact.group) ?? [];
      list.push(artifact);
      sections.set(artifact.group, list);
    }
    return [...sections.entries()].sort(([left], [right]) => {
      const rank = (group: string) =>
        group === "primary" ? 0 : group === "shared" ? 1 : 2;
      return rank(left) - rank(right) || left.localeCompare(right);
    });
  }, [snapshot.artifacts]);

  const groupLabel = (group: string, first: SessionGeneratedArtifact): string => {
    if (group === "primary") return t("artifactsDeliverables");
    if (group === "shared") return t("artifactsShared");
    return first.producer.name;
  };

  const renderArtifact = (artifact: SessionGeneratedArtifact) => (
    <div className="group relative flex min-h-12 items-center gap-2 rounded-[6px] px-2 py-1.5 hover:bg-[#eeeeea] dark:hover:bg-muted" key={artifact.id}>
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setSelected(artifact)} type="button">
        <FileTypeIcon className="h-5 w-5 [&_svg]:h-5 [&_svg]:w-5" kind="file" name={artifact.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-semibold text-[#3f403b] dark:text-foreground">{artifact.name}</span>
          {shouldShowProducer(artifact) ? (
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[9px] text-[#898a83]">
              {artifact.producer.portrait ? (
                <ExpertPortrait className="h-3.5 w-3.5" name={artifact.producer.name} portrait={artifact.producer.portrait} />
              ) : artifact.producer.kind === "primary" ? (
                <img alt="" className="h-3.5 w-3.5 shrink-0 object-contain dark:invert" draggable={false} src={everydayOfficeIcon} />
              ) : (
                <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full bg-[#e5ead9] text-[#657647]"><Sparkles className="h-2.5 w-2.5" /></span>
              )}
              <span className="truncate">{producerLabel(artifact, locale)}</span>
            </span>
          ) : null}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button aria-label={`${artifact.name} actions`} className="grid h-6 w-6 shrink-0 place-items-center rounded-[5px] text-[#85867f] opacity-0 hover:bg-white hover:text-[#40413c] group-hover:opacity-100 focus:opacity-100 dark:hover:bg-card" type="button"><MoreHorizontal className="h-3.5 w-3.5" /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40"><DropdownMenuItem onSelect={() => void action(artifact, "open")}><ExternalLink className="h-3.5 w-3.5" />{t("openFile")}</DropdownMenuItem><DropdownMenuItem onSelect={() => void action(artifact, "reveal")}><FolderOpen className="h-3.5 w-3.5" />{t("openFileLocation")}</DropdownMenuItem><DropdownMenuItem onSelect={() => void action(artifact, "save")}><Save className="h-3.5 w-3.5" />{t("saveAs")}</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  if (selected) {
    if (!preview)
      return (
        <div className="grid min-h-0 flex-1 place-items-center">
          <LoaderCircle className="h-4 w-4 animate-spin text-[#718052]" />
        </div>
      );
    if (preview.status === "available" && preview.kind === "text")
      return (
        <DocumentPreview
          content={preview.content}
          name={selected.name}
          onBack={() => setSelected(null)}
          onOpen={() => void action(selected, "open")}
        />
      );
    if (preview.status === "available" && preview.kind === "image")
      return (
        <section className="flex min-h-0 flex-1 flex-col">
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-[#e4e4df] px-3 dark:border-border">
            <button aria-label={t("back")} className="grid h-6 w-6 place-items-center rounded-[5px] text-[#74746d] hover:bg-[#f0f0ec] dark:hover:bg-muted" onClick={() => setSelected(null)} type="button"><ArrowLeft className="h-3.5 w-3.5" /></button>
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#3e3e39] dark:text-foreground">{selected.name}</span>
            <button aria-label={t("openFile")} className="grid h-6 w-6 place-items-center rounded-[5px] text-[#74746d] hover:bg-[#f0f0ec] dark:hover:bg-muted" onClick={() => void action(selected, "open")} type="button"><ExternalLink className="h-3.5 w-3.5" /></button>
          </header>
          <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-[#f2f2ee] p-3 dark:bg-[#171814]">
            <img alt={selected.name} className="max-h-full max-w-full object-contain" draggable={false} src={`data:${preview.mimeType};base64,${preview.data}`} />
          </div>
        </section>
      );
    return (
      <section className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-[#e4e4df] px-3 dark:border-border">
          <button aria-label={t("back")} className="grid h-6 w-6 place-items-center rounded-[5px] text-[#74746d] hover:bg-[#f0f0ec] dark:hover:bg-muted" onClick={() => setSelected(null)} type="button"><ArrowLeft className="h-3.5 w-3.5" /></button>
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#3e3e39] dark:text-foreground">{selected.name}</span>
        </header>
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div>
            <FileTypeIcon className="mx-auto h-9 w-9 [&_svg]:h-9 [&_svg]:w-9" kind="file" name={selected.name} />
            <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{locale === "zh-CN" ? "此格式请使用本地应用打开。" : "Open this format in its desktop application."}</p>
            <button className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[#596b35] px-3 text-[10px] font-semibold text-white hover:bg-[#4c5d2d]" onClick={() => void action(selected, "open")} type="button"><ExternalLink className="h-3.5 w-3.5" />{t("openFile")}</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="min-h-0 flex-1 p-3">
      {loading ? <div className="grid h-24 place-items-center"><LoaderCircle className="h-4 w-4 animate-spin text-[#718052]" /></div> : snapshot.artifacts.length === 0 ? <div className="grid h-full min-h-[280px] place-items-center px-5 text-center"><div><img alt="" className="mx-auto h-36 w-36 object-contain opacity-65 mix-blend-multiply dark:invert dark:opacity-70 dark:mix-blend-screen" draggable={false} src={emptyArtifactsIcon} /><p className="mt-2 text-[11px] font-medium text-muted-foreground">{t("artifactsEmpty")}</p></div></div> : <div className="space-y-2">{groups.map(([group, artifacts]) => <section key={group}><h3 className="mb-0.5 flex items-center gap-1.5 px-1 font-mono text-[8px] font-medium uppercase tracking-[0.05em] text-[#4f504a] dark:text-[#c9cbc2]">{groupLabel(group, artifacts[0]!)}<span className="shrink-0 font-normal text-[#9a9a92]">({artifacts.length})</span></h3><div className="space-y-0.5">{artifacts.map(renderArtifact)}</div></section>)}</div>}
      {error ? <p className="mt-3 px-2 text-[10px] leading-4 text-destructive">{error}</p> : null}
    </div>
  );
}
