import type { ConfiguredModelKind, ConfiguredModelSummary, ConfiguredProviderSummary, ProviderAvatarId } from "@wordless/domain";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@wordless/ui-kit";
import { Check, CircleHelp, Eye, EyeOff, Trash2 } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { DeleteCustomProviderDialog } from "./DeleteCustomProviderDialog";
import { jsonSyntaxIssue } from "./json-configuration";
import { ProviderAvatarPicker } from "./ProviderAvatarPicker";
import { ProviderIcon } from "./provider-icons";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";

const MODEL_CONFIGURATION_DOCS_URL = "https://wordless.20250230.xyz/docs/models/";
const JsonConfigurationEditor = lazy(() => import("./JsonConfigurationEditor").then((module) => ({ default: module.JsonConfigurationEditor })));

type ProviderConfigurationPanelProps = {
  error: string | null;
  models: ConfiguredModelSummary[];
  onDelete: (provider: ConfiguredProviderSummary) => Promise<void>;
  onLoginWithOAuth: (provider: ConfiguredProviderSummary) => Promise<void>;
  onSave: (provider: ConfiguredProviderSummary, apiKey: string, raw: string, customConfiguration: boolean, avatarId: ProviderAvatarId | null, connection?: ImageProviderConnection) => Promise<void>;
  onSetModelEnabled: (model: ConfiguredModelSummary, enabled: boolean) => Promise<void>;
  provider: ConfiguredProviderSummary | undefined;
  saving: boolean;
};

/**
 * Connection values that are intentionally kept outside the advanced JSON
 * editor for providers that need more than an API key.
 */
export type ImageProviderConnection = {
  region?: BailianRegion;
  workspaceId?: string;
};

type BailianRegion = "cn-beijing" | "ap-southeast-1";

const DEFAULT_BAILIAN_REGION: BailianRegion = "cn-beijing";

export function ProviderConfigurationPanel({ error, models, onDelete, onLoginWithOAuth, onSave, onSetModelEnabled, provider, saving }: ProviderConfigurationPanelProps) {
  const client = useRuntimeClient();
  const { locale, t } = usePreferences();
  const [apiKey, setApiKey] = useState("");
  const [avatarId, setAvatarId] = useState<ProviderAvatarId | null>(null);
  const [customConfiguration, setCustomConfiguration] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [region, setRegion] = useState<BailianRegion>(DEFAULT_BAILIAN_REGION);
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceIdTouched, setWorkspaceIdTouched] = useState(false);
  const placeholder = useMemo(() => provider ? configurationExample(provider.kind, provider.source === "custom") : "", [provider]);
  const rawSyntaxIssue = useMemo(() => jsonSyntaxIssue(raw), [raw]);

  useEffect(() => {
    const configuration = provider?.configuration ?? {};
    const { apiKey: _apiKey, avatarId: configuredAvatarId, ...advancedConfiguration } = configuration;
    const bailianConnection = provider?.kind === "image" && provider.source === "builtin" && provider.id === "bailian"
      ? readBailianConnection(advancedConfiguration.connection)
      : {};
    const editorConfiguration = provider?.kind === "image" && provider.source === "builtin" && provider.id === "bailian"
      ? omitConnection(advancedConfiguration)
      : advancedConfiguration;
    setApiKey(typeof configuration.apiKey === "string" ? configuration.apiKey : "");
    setAvatarId(provider?.avatarId ?? (typeof configuredAvatarId === "string" ? configuredAvatarId as ProviderAvatarId : null));
    setDeleteOpen(false);
    setShowApiKey(false);
    setRegion(bailianConnection.region ?? DEFAULT_BAILIAN_REGION);
    setWorkspaceId(bailianConnection.workspaceId ?? "");
    setWorkspaceIdTouched(false);
    setCustomConfiguration(provider?.source === "custom" || Object.keys(editorConfiguration).length > 0);
    const newCustomProvider = provider?.source === "custom"
      && editorConfiguration.baseUrl === "https://"
      && editorConfiguration.api === (provider.kind === "chat" ? "openai-completions" : "openrouter-images")
      && Array.isArray(editorConfiguration.models)
      && editorConfiguration.models.length === 0;
    setRaw(newCustomProvider ? configurationExample(provider.kind, true) : Object.keys(editorConfiguration).length > 0 ? JSON.stringify(editorConfiguration, null, 2) : "");
  }, [provider?.configuration, provider?.id, provider?.kind]);

  if (!provider) return <main className="grid min-w-0 flex-1 place-items-center p-6 text-sm text-muted-foreground">{t("noModelsAvailable")}</main>;

  const enabledModels = models.filter((model) => model.enabled).length;
  const editorHeight = Math.min(480, Math.max(252, placeholder.split("\n").length * 15 + 24));
  const isBuiltinImage = provider.kind === "image" && provider.source === "builtin";
  const isBailianImage = provider.kind === "image" && provider.source === "builtin" && provider.id === "bailian";
  const apiKeyLabel = isBuiltinImage ? `${provider.displayName} ${t("apiKey")}` : t("apiKey");
  const workspaceIdError = isBailianImage && workspaceIdTouched && !workspaceId.trim()
    ? "Workspace ID is required for Alibaba Cloud Bailian."
    : null;
  const hasSavePayload = Boolean(apiKey.trim() || (customConfiguration && raw.trim()));
  const saveDisabled = saving || !hasSavePayload || Boolean(customConfiguration && rawSyntaxIssue) || (isBailianImage && !workspaceId.trim());
  const imageConnection: ImageProviderConnection | undefined = isBailianImage
    ? { region, ...(workspaceId.trim() ? { workspaceId: workspaceId.trim() } : {}) }
    : undefined;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto p-6 sm:p-8">
      <div className="mx-auto max-w-[700px]">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <ProviderIcon avatarId={provider.avatarId} className="size-9 shrink-0 object-contain" providerId={provider.id} />
            <div className="min-w-0"><p className="truncate text-[18px] font-semibold">{provider.displayName}</p><p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{provider.id}</p></div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {provider.supportsOAuth ? <Button disabled={saving} onClick={() => void onLoginWithOAuth(provider)} size="sm" type="button" variant="outline">{t("oauthLogin")}</Button> : null}
            <span className="rounded-full bg-[#eef1f4] px-2 py-1 font-mono text-[10px] text-[#6e737a] dark:bg-[#303338] dark:text-[#c2c7cc]">{provider.source}</span>
            {provider.source === "custom" ? <Button aria-label={t("deleteCustomProvider")} className="text-[#9a5a4d] hover:bg-[#f8ebe7] hover:text-[#7e4034] dark:hover:bg-[#42231e]" disabled={saving} onClick={() => setDeleteOpen(true)} size="icon" type="button" variant="ghost"><Trash2 className="h-3.5 w-3.5" /></Button> : null}
          </div>
        </div>
        <section className="mb-7">
          <div className="mb-2 flex items-center justify-between gap-4"><div className="flex items-center gap-2"><h2 className="text-[14px] font-medium">{apiKeyLabel}</h2>{provider.apiKeyConfigured ? <span className="font-mono text-[10px] text-[#5b8d2e] dark:text-[#bfe650]">{t("apiKeyConfigured")}</span> : null}</div><Button disabled={saveDisabled} onClick={() => { setWorkspaceIdTouched(isBailianImage); if (imageConnection) void onSave(provider, apiKey, raw, customConfiguration, avatarId, imageConnection); else void onSave(provider, apiKey, raw, customConfiguration, avatarId); }} size="sm" type="button">{t("save")}</Button></div>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <input aria-label={apiKeyLabel} className="h-9 w-full rounded-lg border border-border bg-[#f8f9fa] px-3 pr-10 text-[12px] outline-none placeholder:text-[#90938e] focus:ring-2 focus:ring-ring dark:bg-[#202328] dark:placeholder:text-[#747870]" onChange={(event) => setApiKey(event.target.value)} placeholder={t("apiKeyPlaceholder")} type={showApiKey ? "text" : "password"} value={apiKey} />
              <Button aria-label={showApiKey ? t("hideApiKey") : t("showApiKey")} className="absolute right-1 top-0.5" onClick={() => setShowApiKey((current) => !current)} size="icon" type="button" variant="ghost">{showApiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</Button>
            </div>
          </div>
          {isBailianImage ? <div className="mt-3 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
            <label className="block"><span className="mb-1.5 block text-[11px] font-medium text-foreground">Region</span><select aria-label="Bailian region" className="h-9 w-full rounded-lg border border-border bg-[#f8f9fa] px-2.5 text-[12px] outline-none focus:ring-2 focus:ring-ring dark:bg-[#202328]" onChange={(event) => setRegion(event.target.value as BailianRegion)} value={region}><option value="cn-beijing">Beijing</option><option value="ap-southeast-1">Singapore</option></select></label>
            <label className="block"><span className="mb-1.5 block text-[11px] font-medium text-foreground">Workspace ID</span><input aria-describedby={workspaceIdError ? "bailian-workspace-error" : "bailian-workspace-help"} aria-invalid={Boolean(workspaceIdError)} className={`h-9 w-full rounded-lg border bg-[#f8f9fa] px-3 text-[12px] outline-none placeholder:text-[#90938e] focus:ring-2 focus:ring-ring dark:bg-[#202328] dark:placeholder:text-[#747870] ${workspaceIdError ? "border-[#b42318] focus:border-[#b42318] dark:border-[#ffb4ab] dark:focus:border-[#ffb4ab]" : "border-border"}`} onBlur={() => setWorkspaceIdTouched(true)} onChange={(event) => setWorkspaceId(event.target.value)} placeholder="workspace-id" required value={workspaceId} />{workspaceIdError ? <span className="mt-1 block text-[10px] leading-4 text-[#b42318] dark:text-[#ffb4ab]" id="bailian-workspace-error" role="alert">{workspaceIdError}</span> : <span className="mt-1 block text-[10px] leading-4 text-muted-foreground" id="bailian-workspace-help">Required by the Bailian multimodal API.</span>}</label>
          </div> : null}
          {error ? <p className="mt-2 text-[12px] text-destructive">{error}</p> : null}
        </section>
        {provider.source === "custom" ? <section className="mb-7"><div className="mb-2 flex items-center justify-between gap-4"><h2 className="text-[14px] font-medium">{t("providerAvatar")}</h2><span className="text-[10px] text-muted-foreground">{t("providerAvatarHelp")}</span></div><ProviderAvatarPicker disabled={saving} onChange={setAvatarId} value={avatarId} /></section> : null}
        <section className="mb-7">
          <div className="flex items-start gap-1 rounded-xl border border-border px-3 py-3 transition-colors hover:bg-[#f8f9f7] dark:hover:bg-[#232620]">
            <div className="min-w-0 flex-1"><div className="flex items-center"><h2 className="text-[14px] font-medium">{t("customProviderConfiguration")}</h2><Tooltip><TooltipTrigger asChild><Button aria-label={t("modelConfigurationDocs")} className="-my-1 ml-0.5 size-7 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => void client.openExternalUrl(MODEL_CONFIGURATION_DOCS_URL)} size="icon" type="button" variant="ghost"><CircleHelp className="size-3.5" /></Button></TooltipTrigger><TooltipContent>{MODEL_CONFIGURATION_DOCS_URL}</TooltipContent></Tooltip></div><p className="mt-1 truncate text-[12px] text-muted-foreground">{provider.baseUrl ?? provider.id}</p></div>
            <button aria-checked={customConfiguration} aria-label={t("customProviderConfiguration")} className="grid size-8 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setCustomConfiguration((current) => !current)} role="switch" type="button"><span aria-hidden="true" className={`grid size-5 place-items-center rounded-full border transition-colors ${customConfiguration ? "border-[#a8cf38] bg-[#c8ef59] text-[#24300f]" : "border-[#bfc2ba] bg-transparent text-transparent dark:border-[#585d53]"}`}><Check className="size-3.5 stroke-[3]" /></span></button>
          </div>
          {customConfiguration ? <><Suspense fallback={<div aria-busy="true" className="mt-3 animate-pulse rounded-xl border border-border bg-muted/35" style={{ height: `${editorHeight + 37}px` }} />}><JsonConfigurationEditor error={rawSyntaxIssue} example={placeholder} locale={locale} minHeight={editorHeight} onChange={setRaw} value={raw} /></Suspense><p className="mt-2 text-[12px] text-muted-foreground">{provider.kind === "image" ? "The protocol controls the request shape. Model capabilities control reference limits, output count, ratios, resolutions, formats, quality, seed, and watermark settings." : "baseUrl, headers, compat, models and modelOverrides are written to models.json. thinkingLevelMap keys are off, minimal, low, medium, high, xhigh and max. Custom models only expose listed levels; strings are sent to the provider. Use null in modelOverrides to disable an inherited level."}</p></> : null}
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-[14px] font-medium">Enabled models</h2><span className="font-mono text-[11px] text-muted-foreground">{enabledModels}/{models.length}</span></div>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {models.map((model) => <EnabledModelRow avatarId={provider.avatarId} key={model.modelId} model={model} onSetEnabled={onSetModelEnabled} providerId={provider.id} />)}
          </div>
        </section>
      </div>
      <DeleteCustomProviderDialog onCancel={() => setDeleteOpen(false)} onConfirm={() => { void onDelete(provider).then(() => setDeleteOpen(false)).catch(() => undefined); }} open={deleteOpen} providerName={provider.displayName} saving={saving} />
    </main>
  );
}

function EnabledModelRow({ avatarId, model, onSetEnabled, providerId }: { avatarId: ProviderAvatarId | null; model: ConfiguredModelSummary; onSetEnabled: (model: ConfiguredModelSummary, enabled: boolean) => Promise<void>; providerId: string }) {
  const capabilityLabels = model.kind === "image" ? imageCapabilityLabels(model.imageCapabilities) : [];
  return (
    <button
      aria-checked={model.enabled}
      className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors ${model.enabled ? "bg-[#f7faec] dark:bg-[#20291a]" : "hover:bg-[#f8f9f7] dark:hover:bg-[#232620]"}`}
      onClick={() => void onSetEnabled(model, !model.enabled)}
      role="checkbox"
      type="button"
    >
      <ProviderIcon avatarId={avatarId} className="grid size-7 shrink-0 place-items-center object-contain" providerId={providerId} />
      <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{model.displayName}</span><span className="block truncate font-mono text-[10px] text-muted-foreground">{model.modelId} · {model.api}</span>{capabilityLabels.length > 0 ? <span className="mt-1 flex flex-wrap gap-1">{capabilityLabels.map((label) => <span className="rounded bg-[#eef1f4] px-1.5 py-0.5 text-[9px] leading-3 text-[#6e737a] dark:bg-[#303338] dark:text-[#c2c7cc]" key={label}>{label}</span>)}</span> : null}</span>
      <span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center rounded-full border transition-colors ${model.enabled ? "border-[#a8cf38] bg-[#c8ef59] text-[#24300f]" : "border-[#bfc2ba] bg-transparent text-transparent dark:border-[#585d53]"}`}>
        <Check className="size-3.5 stroke-[3]" />
      </span>
    </button>
  );
}

function imageCapabilityLabels(capabilities: ConfiguredModelSummary["imageCapabilities"]): string[] {
  if (!capabilities) return [];
  const labels: string[] = [];
  if (capabilities.supportsReferenceImageEditing) labels.push("Reference edit");
  if (capabilities.supportsMaskEditing) labels.push("Mask");
  if (capabilities.supportsTransparentBackground) labels.push("Transparent");
  if (capabilities.maxOutputImages && capabilities.maxOutputImages > 1) labels.push(`Up to ${capabilities.maxOutputImages}`);
  return labels;
}

function configurationExample(kind: ConfiguredModelKind, customProvider: boolean): string {
  if (kind === "image") {
    return JSON.stringify({
      name: "Studio Images",
      baseUrl: "https://api.example.com/v1",
      api: "openrouter-images",
      models: [{
        id: "image-model-id",
        name: "Studio Image",
        input: ["text", "image"],
        output: ["image"],
        capabilities: {
          supportsTextToImage: true,
          supportsReferenceImageEditing: true,
          supportsMaskEditing: false,
          supportsTransparentBackground: false,
          maxReferenceImages: 3,
          maxOutputImages: 1,
          aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
          resolutions: ["1K", "2K"],
          outputFormats: ["png", "jpeg"],
          qualityLevels: ["auto"],
          supportsSeed: false,
          supportsWatermark: false,
        },
      }],
    }, null, 2);
  }
  if (customProvider) {
    return JSON.stringify({ name: "Company AI", baseUrl: "https://model.example.com/v1", api: "openai-completions", headers: { "X-Client": "Wordless" }, models: [{ id: "chat-model-prod", name: "Company Chat", reasoning: true, input: ["text", "image"], contextWindow: 128000, maxTokens: 16384, thinkingLevelMap: { off: "none", low: "low", medium: "medium", high: "high" } }] }, null, 2);
  }
  return JSON.stringify({ baseUrl: "https://api.example.com/v1", headers: { "X-Client": "Wordless" }, modelOverrides: { "model-id": { reasoning: true, contextWindow: 128000, thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high" } } } }, null, 2);
}

function readBailianConnection(value: unknown): ImageProviderConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const connection = value as Record<string, unknown>;
  const region = connection.region === "cn-beijing" || connection.region === "ap-southeast-1" ? connection.region : undefined;
  const workspaceId = typeof connection.workspaceId === "string" ? connection.workspaceId : undefined;
  return { ...(region ? { region } : {}), ...(workspaceId ? { workspaceId } : {}) };
}

function omitConnection(configuration: Record<string, unknown>): Record<string, unknown> {
  const { connection: _connection, ...withoutConnection } = configuration;
  return withoutConnection;
}
