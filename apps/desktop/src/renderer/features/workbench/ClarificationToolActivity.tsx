import { Check, CircleHelp, ClipboardCopy, Lightbulb, ListChecks, MessageCircleQuestion } from "lucide-react";
import { useMemo, useState } from "react";
import type { ClarificationBrief, ClarificationQuestion, MessageToolBlock } from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";

type ClarificationToolActivityProps = {
  block: MessageToolBlock;
  canPlan?: boolean;
  onHandoff?: (interactionMode: "default" | "clarify" | "plan") => void | Promise<void>;
  onResolveQuestion?: (callId: string, value: string | boolean) => void | Promise<void>;
};

type LocalizedText = {
  answer: string;
  continueClarifying: string;
  customAnswer: string;
  defaultMode: string;
  goals: string;
  modeNext: string;
  no: string;
  openQuestions: string;
  plan: string;
  recommended: string;
  recommendedNextStep: string;
  recommendation: string;
  response: string;
  submit: string;
  summary: string;
  yes: string;
  constraints: string;
  decisions: string;
};

function textFor(locale: "zh-CN" | "en-US"): LocalizedText {
  return locale === "zh-CN"
    ? {
      answer: "回答",
      continueClarifying: "继续澄清",
      constraints: "约束",
      customAnswer: "输入其他回答",
      decisions: "已确认决策",
      defaultMode: "返回默认模式",
      goals: "目标",
      modeNext: "下一步",
      no: "否",
      openQuestions: "待确认问题",
      plan: "进入计划并生成计划",
      recommended: "推荐",
      recommendedNextStep: "建议下一步",
      recommendation: "Wordless 的建议",
      response: "你的回答",
      submit: "提交回答",
      summary: "澄清简报",
      yes: "是",
    }
    : {
      answer: "Answer",
      continueClarifying: "Continue clarifying",
      constraints: "Constraints",
      customAnswer: "Enter another answer",
      decisions: "Confirmed decisions",
      defaultMode: "Return to default",
      goals: "Goals",
      modeNext: "Next mode",
      no: "No",
      openQuestions: "Open questions",
      plan: "Plan from this brief",
      recommended: "Recommended",
      recommendedNextStep: "Recommended next step",
      recommendation: "Wordless recommends",
      response: "Your answer",
      submit: "Submit answer",
      summary: "Clarification brief",
      yes: "Yes",
    };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function clarificationQuestion(value: unknown): ClarificationQuestion | undefined {
  const details = record(value);
  const question = record(details?.clarificationQuestion);
  const recommendation = record(question?.recommendation);
  if (!question || typeof question.question !== "string" || !recommendation || typeof recommendation.answer !== "string" || typeof recommendation.reason !== "string") return undefined;
  if (question.answerType !== "choice" && question.answerType !== "text" && question.answerType !== "confirm") return undefined;
  if (question.purpose !== "discovery" && question.purpose !== "final-confirmation") return undefined;
  const options = Array.isArray(question.options) ? question.options.flatMap((item) => {
    const option = record(item);
    return typeof option?.value === "string" && typeof option.label === "string"
      ? [{ value: option.value, label: option.label, ...(typeof option.description === "string" ? { description: option.description } : {}) }]
      : [];
  }) : undefined;
  if (question.answerType === "choice" && (!options || options.length === 0)) return undefined;
  return {
    question: question.question,
    ...(typeof question.context === "string" ? { context: question.context } : {}),
    answerType: question.answerType,
    ...(options ? { options } : {}),
    recommendation: {
      answer: recommendation.answer,
      ...(typeof recommendation.value === "string" ? { value: recommendation.value } : {}),
      reason: recommendation.reason,
    },
    ...(typeof question.allowCustom === "boolean" ? { allowCustom: question.allowCustom } : {}),
    purpose: question.purpose,
  };
}

function clarificationBrief(value: unknown): ClarificationBrief | undefined {
  const details = record(value);
  const brief = record(details?.clarificationBrief);
  if (!brief || typeof brief.title !== "string" || typeof brief.summary !== "string" || typeof brief.recommendedNextStep !== "string") return undefined;
  const strings = (candidate: unknown) => Array.isArray(candidate) ? candidate.filter((item): item is string => typeof item === "string") : [];
  const decisions = Array.isArray(brief.decisions) ? brief.decisions.flatMap((item) => {
    const decision = record(item);
    return typeof decision?.topic === "string" && typeof decision.outcome === "string"
      ? [{ topic: decision.topic, outcome: decision.outcome, ...(typeof decision.rationale === "string" ? { rationale: decision.rationale } : {}) }]
      : [];
  }) : [];
  return {
    title: brief.title,
    summary: brief.summary,
    goals: strings(brief.goals),
    constraints: strings(brief.constraints),
    decisions,
    openQuestions: strings(brief.openQuestions),
    recommendedNextStep: brief.recommendedNextStep,
  };
}

function clarificationAnswer(value: unknown): string | boolean | undefined {
  const details = record(value);
  const answer = record(details?.clarificationAnswer);
  return typeof answer?.value === "string" || typeof answer?.value === "boolean" ? answer.value : undefined;
}

export function ClarificationQuestionToolActivity({ block, onResolveQuestion }: ClarificationToolActivityProps) {
  const { locale } = usePreferences();
  const copy = textFor(locale);
  const question = clarificationQuestion(block.details);
  const answered = clarificationAnswer(block.details);
  const [value, setValue] = useState<string | boolean>("");
  const [customValue, setCustomValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = question?.answerType === "confirm" ? typeof value === "boolean" : typeof value === "string" && value.trim().length > 0;

  const answerLabel = useMemo(() => {
    if (!question || answered === undefined) return undefined;
    if (typeof answered === "boolean") return answered ? copy.yes : copy.no;
    return question.options?.find((option) => option.value === answered)?.label ?? answered;
  }, [answered, copy.no, copy.yes, question]);

  if (!question) return null;

  const submit = async () => {
    if (!onResolveQuestion || !canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onResolveQuestion(block.callId, value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSubmitting(false);
    }
  };

  if (answered !== undefined) {
    return <section className="py-3.5"><div className="flex items-center gap-2.5 text-[12px]"><span className="grid h-6 w-6 place-items-center rounded-[6px] bg-[#edf2df] text-[#667d2f] dark:bg-[#34401f] dark:text-[#d1e689]"><Check className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1 truncate font-medium text-[#454540] dark:text-foreground">{question.question}</span><span className="max-w-[42%] truncate text-[#76766f] dark:text-muted-foreground">{answerLabel}</span></div></section>;
  }

  return <section className="py-4"><div className="flex gap-3"><span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-[#edf2df] text-[#667d2f] dark:bg-[#34401f] dark:text-[#d1e689]"><MessageCircleQuestion className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-[13px] font-semibold text-[#3e3e39] dark:text-foreground">{question.question}</p><span className="font-mono text-[10px] text-[#96968e]">{question.purpose === "final-confirmation" ? "CHECK" : "CLARIFY"}</span></div>{question.context ? <p className="mt-1 text-[12px] leading-5 text-[#777770] dark:text-muted-foreground">{question.context}</p> : null}<div className="mt-3 border-l-2 border-[#a7bd68] bg-[#f7f9ef] px-3 py-2 dark:border-[#9fba55] dark:bg-[#29331d]"><div className="flex items-center gap-1.5 text-[10px] font-semibold text-[#62772b] dark:text-[#d7ec9a]"><Lightbulb className="h-3.5 w-3.5" />{copy.recommendation}</div><p className="mt-1 text-[12px] font-medium text-[#4d5931] dark:text-[#e5efc7]">{question.recommendation.answer}</p><p className="mt-0.5 text-[11px] leading-4 text-[#6f775d] dark:text-[#c0caae]">{question.recommendation.reason}</p></div><div className="mt-3">{question.answerType === "choice" ? <div className="grid gap-1.5">{question.options?.map((option) => <label className={`flex cursor-pointer items-start gap-2 rounded-[6px] border px-2.5 py-2 transition-colors ${value === option.value ? "border-[#a8bd69] bg-[#f3f6e8] dark:border-[#9fba55] dark:bg-[#303c1f]" : "border-[#e2e2dc] hover:border-[#c8c8c1] dark:border-border dark:hover:border-[#676760]"}`} key={option.value}><input checked={value === option.value} className="mt-0.5 accent-[#62772b]" name={`${block.callId}-answer`} onChange={() => setValue(option.value)} type="radio" /><span><span className="flex items-center gap-1.5 text-[11px] font-medium text-[#4e4e49] dark:text-foreground">{option.label}{question.recommendation.value === option.value ? <span className="rounded bg-[#dfe9bf] px-1 py-0.5 text-[9px] text-[#50622a] dark:bg-[#52642f] dark:text-[#edf9c7]">{copy.recommended}</span> : null}</span>{option.description ? <span className="mt-0.5 block text-[10px] leading-4 text-[#898981] dark:text-muted-foreground">{option.description}</span> : null}</span></label>)}{question.allowCustom ? <label className={`flex items-center gap-2 rounded-[6px] border px-2.5 py-2 ${typeof value === "string" && !question.options?.some((option) => option.value === value) ? "border-[#a8bd69] bg-[#f3f6e8] dark:border-[#9fba55] dark:bg-[#303c1f]" : "border-[#e2e2dc] dark:border-border"}`}><input checked={typeof value === "string" && !question.options?.some((option) => option.value === value)} className="accent-[#62772b]" name={`${block.callId}-answer`} onChange={() => setValue(customValue)} type="radio" /><input className="min-w-0 flex-1 bg-transparent text-[11px] text-[#4e4e49] outline-none placeholder:text-[#a1a19a] dark:text-foreground" onChange={(event) => { setCustomValue(event.target.value); setValue(event.target.value); }} placeholder={copy.customAnswer} value={customValue} /></label> : null}</div> : question.answerType === "confirm" ? <div className="flex gap-2"><button className={`rounded-[6px] border px-3 py-1.5 text-[11px] font-medium ${value === true ? "border-[#9aac61] bg-[#eaf2d1] text-[#4e6128] dark:border-[#9fba55] dark:bg-[#354321] dark:text-[#e7f5bd]" : "border-[#deded8] text-[#6c6c66] dark:border-border dark:text-muted-foreground"}`} onClick={() => setValue(true)} type="button">{copy.yes}</button><button className={`rounded-[6px] border px-3 py-1.5 text-[11px] font-medium ${value === false ? "border-[#c99d8f] bg-[#f9ece7] text-[#925346] dark:border-[#a86b5e] dark:bg-[#3a2520] dark:text-[#f0b2a6]" : "border-[#deded8] text-[#6c6c66] dark:border-border dark:text-muted-foreground"}`} onClick={() => setValue(false)} type="button">{copy.no}</button></div> : <textarea className="block min-h-20 w-full resize-y rounded-[6px] border border-[#deded8] bg-white px-2.5 py-2 text-[12px] leading-5 text-[#42423d] outline-none placeholder:text-[#a1a19a] focus:border-[#a9b57f] dark:border-border dark:bg-card dark:text-foreground" onChange={(event) => setValue(event.target.value)} placeholder={copy.answer} value={typeof value === "string" ? value : ""} />}</div><div className="mt-3 flex items-center gap-2"><button className="rounded-[6px] bg-[#252624] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#3a3b37] disabled:cursor-not-allowed disabled:bg-[#b5b5b0] dark:bg-[#d9f37a] dark:text-[#252624] dark:hover:bg-[#e4f99c]" disabled={!canSubmit || submitting} onClick={() => void submit()} type="button">{copy.submit}</button>{error ? <span className="text-[11px] text-destructive">{error}</span> : null}</div></div></div></section>;
}

export function ClarificationBriefToolActivity({ block, canPlan = false, onHandoff }: ClarificationToolActivityProps) {
  const { locale } = usePreferences();
  const copy = textFor(locale);
  const brief = clarificationBrief(block.details);
  const [pending, setPending] = useState<"default" | "clarify" | "plan" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  if (!brief) return null;
  const handoff = async (interactionMode: "default" | "clarify" | "plan") => {
    if (!onHandoff || pending) return;
    setPending(interactionMode);
    setError(null);
    try {
      await onHandoff(interactionMode);
      setCompleted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(null);
    }
  };
  const copyBrief = () => void navigator.clipboard.writeText([brief.title, brief.summary, ...brief.goals.map((goal) => `- ${goal}`), ...brief.constraints.map((constraint) => `- ${constraint}`), ...brief.decisions.map((decision) => `- ${decision.topic}: ${decision.outcome}`), ...brief.openQuestions.map((question) => `- ${question}`), brief.recommendedNextStep].join("\n"));
  const section = (title: string, items: string[]) => items.length > 0 ? <div className="mt-4"><p className="font-mono text-[10px] font-semibold uppercase text-[#7f8772] dark:text-[#b7c19f]">{title}</p><ul className="mt-1.5 space-y-1 text-[12px] leading-5 text-[#5a5a54] dark:text-muted-foreground">{items.map((item) => <li className="flex gap-2" key={item}><span className="text-[#87a44c]">•</span><span>{item}</span></li>)}</ul></div> : null;
  return <section className="py-4"><div className="border border-[#dce4c4] bg-[#fafcf4] p-4 dark:border-[#526431] dark:bg-[#202719]"><header className="flex items-start gap-2.5"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-[#e7f0c8] text-[#61792e] dark:bg-[#3c4b22] dark:text-[#d8eca0]"><ListChecks className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-[13px] font-semibold text-[#3e482c] dark:text-[#e6f0cc]">{brief.title}</p><p className="mt-0.5 font-mono text-[10px] text-[#81906a] dark:text-[#b9c89b]">{copy.summary}</p></div><button aria-label="Copy clarification brief" className="grid h-7 w-7 place-items-center rounded-[5px] text-[#79836c] hover:bg-[#edf3db] hover:text-[#4e6128] dark:hover:bg-[#354321] dark:hover:text-[#e7f5bd]" onClick={copyBrief} title="Copy" type="button"><ClipboardCopy className="h-3.5 w-3.5" /></button></header><p className="mt-3 whitespace-pre-wrap text-[12px] leading-5 text-[#4e5247] dark:text-[#d8dccf]">{brief.summary}</p>{section(copy.goals, brief.goals)}{section(copy.constraints, brief.constraints)}{brief.decisions.length > 0 ? <div className="mt-4"><p className="font-mono text-[10px] font-semibold uppercase text-[#7f8772] dark:text-[#b7c19f]">{copy.decisions}</p><div className="mt-1.5 space-y-1.5">{brief.decisions.map((decision) => <div className="border-l border-[#c4d49b] pl-2.5 dark:border-[#6a7e40]" key={`${decision.topic}-${decision.outcome}`}><p className="text-[11px] font-semibold text-[#515a3d] dark:text-[#dce8c2]">{decision.topic}</p><p className="mt-0.5 text-[11px] leading-4 text-[#686f5e] dark:text-[#bfc9aa]">{decision.outcome}</p>{decision.rationale ? <p className="mt-0.5 text-[10px] leading-4 text-[#858d79] dark:text-[#aeb99b]">{decision.rationale}</p> : null}</div>)}</div></div> : null}{section(copy.openQuestions, brief.openQuestions)}<div className="mt-4 border-t border-[#dfe7c9] pt-3 dark:border-[#4d5d31]"><p className="font-mono text-[10px] font-semibold uppercase text-[#7f8772] dark:text-[#b7c19f]">{copy.recommendedNextStep}</p><p className="mt-1 text-[12px] leading-5 text-[#4e5247] dark:text-[#d8dccf]">{brief.recommendedNextStep}</p></div></div>{!completed ? <div className="mt-3 border-l-2 border-[#a9bc70] bg-[#f7f9ef] px-3 py-2 dark:border-[#9fba55] dark:bg-[#28321d]"><p className="text-[10px] font-semibold text-[#65763d] dark:text-[#d7ec9a]">{copy.modeNext}</p><div className="mt-1.5 flex flex-wrap gap-1"><button className="h-6 rounded-[5px] border border-[#b7c98b] bg-white px-2 text-[10px] font-medium text-[#53652d] hover:bg-[#eef4dc] disabled:opacity-50 dark:border-[#718b43] dark:bg-[#202719] dark:text-[#d7ec9a] dark:hover:bg-[#354321]" disabled={pending !== null} onClick={() => void handoff("clarify")} type="button">{pending === "clarify" ? "..." : copy.continueClarifying}</button>{canPlan ? <button className="h-6 rounded-[5px] bg-[#252624] px-2 text-[10px] font-semibold text-white hover:bg-[#3a3b37] disabled:opacity-50 dark:bg-[#d9f37a] dark:text-[#252624] dark:hover:bg-[#e4f99c]" disabled={pending !== null} onClick={() => void handoff("plan")} type="button">{pending === "plan" ? "..." : copy.plan}</button> : null}<button className="h-6 rounded-[5px] px-2 text-[10px] font-medium text-[#6d6d66] hover:bg-[#ecefe5] disabled:opacity-50 dark:text-muted-foreground dark:hover:bg-muted" disabled={pending !== null} onClick={() => void handoff("default")} type="button">{pending === "default" ? "..." : copy.defaultMode}</button></div>{error ? <p className="mt-1.5 text-[10px] text-destructive">{error}</p> : null}</div> : null}</section>;
}
