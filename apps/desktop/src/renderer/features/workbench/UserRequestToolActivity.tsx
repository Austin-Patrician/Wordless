import { Switch } from "@wordless/ui-kit";
import { Check, ChevronDown, CircleHelp, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MessageToolBlock, UserRequestAnswer, UserRequestField } from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";

export type UserRequestToolActivityProps = {
  block: MessageToolBlock;
  onResolveUserRequest?: (
    requestId: string,
    resolution: { status: "submitted" | "cancelled"; answers?: Record<string, UserRequestAnswer>; feedback?: string },
  ) => void | Promise<void>;
};

function initialAnswers(fields: UserRequestField[]): Record<string, UserRequestAnswer> {
  return Object.fromEntries(fields.flatMap((field): Array<[string, UserRequestAnswer]> => {
    if (field.type === "confirm") return [[field.id, field.defaultValue ?? false]];
    if (field.type === "multi-select") return [[field.id, field.defaultValue ?? []]];
    if (field.defaultValue !== undefined) return [[field.id, field.defaultValue]];
    return [];
  }));
}

function answerText(field: UserRequestField, answer: UserRequestAnswer | undefined, confirmedLabel: string, cancelledLabel: string): string {
  if (answer === undefined) return "-";
  if (typeof answer === "boolean") return answer ? confirmedLabel : cancelledLabel;
  const optionLabel = (value: string) => {
    if (field.type !== "select" && field.type !== "multi-select") return value;
    return field.options.find((option) => option.value === value)?.label ?? value;
  };
  return Array.isArray(answer) ? answer.map(optionLabel).join(", ") : optionLabel(answer);
}

function isFieldComplete(field: UserRequestField, value: UserRequestAnswer | undefined): boolean {
  if (!field.required) return true;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function UserRequestToolActivity({ block, onResolveUserRequest }: UserRequestToolActivityProps) {
  const { t } = usePreferences();
  const interaction = block.userRequest;
  const request = interaction?.request;
  const [answers, setAnswers] = useState<Record<string, UserRequestAnswer>>(() => request ? initialAnswers(request.fields) : {});
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!request) return;
    setAnswers(initialAnswers(request.fields));
    setCustomValues({});
    setError(null);
    setSubmitting(false);
  }, [request?.requestId]);

  const missingRequired = useMemo(
    () => request?.fields.some((field) => !isFieldComplete(field, answers[field.id])) ?? false,
    [answers, request?.fields],
  );

  if (!request) return null;
  const resolution = interaction?.resolution;
  const resolved = resolution !== undefined;

  const resolve = async (next: { status: "submitted" | "cancelled"; answers?: Record<string, UserRequestAnswer> }) => {
    if (!onResolveUserRequest) {
      setError(t("userRequestUnavailable"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onResolveUserRequest(request.requestId, next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSubmitting(false);
    }
  };

  const submit = () => {
    if (missingRequired) {
      setError(t("requiredResponse"));
      return;
    }
    const next = { ...answers };
    for (const field of request.fields) {
      const custom = customValues[field.id]?.trim();
      if (!custom) continue;
      if (field.type === "select") next[field.id] = custom;
      if (field.type === "multi-select") {
        const current = next[field.id];
        const selected: string[] = Array.isArray(current) ? current : [];
        next[field.id] = [...selected, custom];
      }
    }
    void resolve({ status: "submitted", answers: next });
  };

  return (
    <section className="py-4">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[6px] bg-[#edf2df] text-[#667d2f] dark:bg-[#34401f] dark:text-[#d1e689]"><CircleHelp className="h-3.5 w-3.5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="text-[13px] font-semibold text-[#3d3d38] dark:text-foreground">{request.title}</p><span className="font-mono text-[10px] text-[#91918a]">{resolved ? resolution.status === "submitted" ? t("responseSubmitted") : t("requestCancelled") : t("awaitingResponse")}</span></div>
          {request.description ? <p className="mt-1 text-[12px] leading-5 text-[#777770] dark:text-muted-foreground">{request.description}</p> : null}
          {resolved ? <dl className="mt-3 space-y-1.5 border-l border-[#deded8] pl-3 dark:border-border">{request.fields.map((field) => <div className="flex gap-3 text-[11px]" key={field.id}><dt className="shrink-0 text-[#8b8b84] dark:text-muted-foreground">{field.label}</dt><dd className="min-w-0 font-medium text-[#51514d] dark:text-foreground">{answerText(field, resolution.answers?.[field.id], t("confirm"), t("cancel"))}</dd></div>)}</dl> : <div className="mt-4 space-y-4">{request.fields.map((field) => <UserRequestFieldControl answers={answers} customValues={customValues} field={field} key={field.id} onAnswersChange={setAnswers} onCustomValuesChange={setCustomValues} />)}</div>}
          {!resolved ? <div className="mt-4 flex items-center gap-2"><button className="rounded-[6px] bg-[#252624] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#3a3b37] disabled:cursor-not-allowed disabled:bg-[#b5b5b0] dark:bg-[#d9f37a] dark:text-[#252624] dark:hover:bg-[#e4f99c]" disabled={submitting || missingRequired} onClick={submit} type="button">{t("submitResponse")}</button><button className="rounded-[6px] px-2 py-1.5 text-[11px] font-medium text-[#777770] hover:bg-[#f1f1ed] hover:text-[#3d3d38] disabled:opacity-50 dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground" disabled={submitting} onClick={() => void resolve({ status: "cancelled" })} type="button">{t("cancel")}</button></div> : null}
          {error ? <p className="mt-2 text-[11px] text-destructive">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}

function UserRequestFieldControl({
  field,
  answers,
  customValues,
  onAnswersChange,
  onCustomValuesChange,
}: {
  field: UserRequestField;
  answers: Record<string, UserRequestAnswer>;
  customValues: Record<string, string>;
  onAnswersChange: (next: Record<string, UserRequestAnswer>) => void;
  onCustomValuesChange: (next: Record<string, string>) => void;
}) {
  const { t } = usePreferences();
  const value = answers[field.id];
  const selected = typeof value === "string" ? value : undefined;
  const selectedValues = Array.isArray(value) ? value : [];
  const isCustomSelected = field.type === "select" && selected !== undefined && !field.options.some((option) => option.value === selected);

  return (
    <fieldset>
      <legend className="flex items-center gap-1 text-[12px] font-medium text-[#4d4d48] dark:text-foreground">{field.label}{field.required ? <span className="text-[#8b604c]">*</span> : null}</legend>
      {field.description ? <p className="mt-0.5 text-[11px] leading-5 text-[#898981] dark:text-muted-foreground">{field.description}</p> : null}
      {field.type === "text" ? field.multiline ? <textarea className="mt-2 block min-h-20 w-full resize-y rounded-[6px] border border-[#deded8] bg-white px-2.5 py-2 text-[12px] leading-5 text-[#42423d] outline-none placeholder:text-[#a1a19a] focus:border-[#a9b57f] dark:border-border dark:bg-card dark:text-foreground" onChange={(event) => onAnswersChange({ ...answers, [field.id]: event.target.value })} placeholder={field.placeholder} value={typeof value === "string" ? value : ""} /> : <input className="mt-2 block h-8 w-full rounded-[6px] border border-[#deded8] bg-white px-2.5 text-[12px] text-[#42423d] outline-none placeholder:text-[#a1a19a] focus:border-[#a9b57f] dark:border-border dark:bg-card dark:text-foreground" onChange={(event) => onAnswersChange({ ...answers, [field.id]: event.target.value })} placeholder={field.placeholder} value={typeof value === "string" ? value : ""} /> : null}
      {field.type === "confirm" ? <label className="mt-2 flex w-fit cursor-pointer items-center gap-2"><Switch checked={value === true} onCheckedChange={(checked) => onAnswersChange({ ...answers, [field.id]: checked })} /><span className="text-[11px] text-[#666660] dark:text-muted-foreground">{value === true ? t("confirm") : t("cancel")}</span></label> : null}
      {field.type === "select" ? <div className="mt-2 grid gap-1.5">{field.options.map((option) => <label className={`flex cursor-pointer items-start gap-2 rounded-[6px] border px-2.5 py-2 transition-colors ${selected === option.value ? "border-[#afb981] bg-[#f4f6eb] dark:border-[#9fba55] dark:bg-[#303c1f]" : "border-[#e2e2dc] hover:border-[#c8c8c1] dark:border-border dark:hover:border-[#676760]"}`} key={option.value}><input checked={selected === option.value} className="mt-0.5 accent-[#62772b]" name={`${field.id}-option`} onChange={() => onAnswersChange({ ...answers, [field.id]: option.value })} type="radio" /><span><span className="block text-[11px] font-medium text-[#4e4e49] dark:text-foreground">{option.label}</span>{option.description ? <span className="mt-0.5 block text-[10px] leading-4 text-[#898981] dark:text-muted-foreground">{option.description}</span> : null}</span></label>)}{field.allowCustom ? <label className={`flex cursor-pointer items-center gap-2 rounded-[6px] border px-2.5 py-2 ${isCustomSelected ? "border-[#afb981] bg-[#f4f6eb] dark:border-[#9fba55] dark:bg-[#303c1f]" : "border-[#e2e2dc] dark:border-border"}`}><input checked={isCustomSelected} className="accent-[#62772b]" name={`${field.id}-option`} onChange={() => onAnswersChange({ ...answers, [field.id]: customValues[field.id] ?? "" })} type="radio" /><input className="min-w-0 flex-1 bg-transparent text-[11px] text-[#4e4e49] outline-none placeholder:text-[#a1a19a] dark:text-foreground" onChange={(event) => { const next = event.target.value; onCustomValuesChange({ ...customValues, [field.id]: next }); onAnswersChange({ ...answers, [field.id]: next }); }} placeholder={t("otherResponse")} value={customValues[field.id] ?? ""} /></label> : null}</div> : null}
      {field.type === "multi-select" ? <div className="mt-2 grid gap-1.5">{field.options.map((option) => <label className={`flex cursor-pointer items-start gap-2 rounded-[6px] border px-2.5 py-2 transition-colors ${selectedValues.includes(option.value) ? "border-[#afb981] bg-[#f4f6eb] dark:border-[#9fba55] dark:bg-[#303c1f]" : "border-[#e2e2dc] hover:border-[#c8c8c1] dark:border-border dark:hover:border-[#676760]"}`} key={option.value}><input checked={selectedValues.includes(option.value)} className="mt-0.5 accent-[#62772b]" onChange={() => onAnswersChange({ ...answers, [field.id]: selectedValues.includes(option.value) ? selectedValues.filter((selectedValue) => selectedValue !== option.value) : [...selectedValues, option.value] })} type="checkbox" /><span><span className="block text-[11px] font-medium text-[#4e4e49] dark:text-foreground">{option.label}</span>{option.description ? <span className="mt-0.5 block text-[10px] leading-4 text-[#898981] dark:text-muted-foreground">{option.description}</span> : null}</span></label>)}{field.allowCustom ? <input className="h-8 rounded-[6px] border border-[#e2e2dc] bg-white px-2.5 text-[11px] text-[#4e4e49] outline-none placeholder:text-[#a1a19a] focus:border-[#a9b57f] dark:border-border dark:bg-card dark:text-foreground" onChange={(event) => onCustomValuesChange({ ...customValues, [field.id]: event.target.value })} placeholder={t("otherResponse")} value={customValues[field.id] ?? ""} /> : null}</div> : null}
    </fieldset>
  );
}
