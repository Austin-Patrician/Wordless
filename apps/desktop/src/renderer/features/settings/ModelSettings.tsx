import type { ConfiguredModelKind, ConfiguredModelSummary, ConfiguredProviderSummary, ModelConfigurationSnapshot, ProviderAvatarId } from "@wordless/domain";
import { useEffect, useMemo, useState } from "react";
import { ProviderConfigurationPanel, type ImageProviderConnection } from "./ProviderConfigurationPanel";
import { ProviderSidebar } from "./ProviderSidebar";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";

type EnabledModelOverrides = Record<string, boolean>;

function modelKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

export function ModelSettings() {
  const client = useRuntimeClient();
  const { refresh } = useRuntime();
  const [configuration, setConfiguration] = useState<ModelConfigurationSnapshot | null>(null);
  const [kind, setKind] = useState<ConfiguredModelKind>("chat");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enabledOverrides, setEnabledOverrides] = useState<EnabledModelOverrides>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const providers = useMemo(
    () => configuration?.providers.filter((provider) => provider.kind === kind) ?? [],
    [configuration, kind],
  );
  const selectedProvider = providers.find((provider) => provider.id === selectedId) ?? providers[0];
  const models = useMemo(
    () => (configuration?.models.filter((model) => model.kind === kind && model.providerId === selectedProvider?.id) ?? []).map((model) => ({
      ...model,
      enabled: enabledOverrides[modelKey(model.providerId, model.modelId)] ?? model.enabled,
    })),
    [configuration, enabledOverrides, kind, selectedProvider?.id],
  );

  const reload = async () => {
    const next = await client.getModelConfiguration();
    setConfiguration(next);
    setEnabledOverrides({});
    return next;
  };

  useEffect(() => {
    void reload().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [client]);

  useEffect(() => {
    if (selectedProvider && selectedProvider.id !== selectedId) setSelectedId(selectedProvider.id);
  }, [selectedId, selectedProvider]);

  const saveProviderConfiguration = async (provider: ConfiguredProviderSummary, apiKey: string, baseUrl: string, raw: string, customConfiguration: boolean, avatarId: ProviderAvatarId | null, enabledModelIds?: string[], connection?: ImageProviderConnection) => {
    try {
      const parsed = customConfiguration && raw.trim() ? JSON.parse(raw) as unknown : {};
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Provider configuration must be a JSON object.");
      }
      setSaving(true);
      setError(null);
      const advancedConfiguration = parsed as Record<string, unknown>;
      const { apiKey: _apiKey, avatarId: _avatarId, baseUrl: _baseUrl, ...configurationWithoutReservedFields } = advancedConfiguration;
      const nextApiKey = apiKey.trim();
      const customChatBaseUrl = provider.kind === "chat" && provider.source === "custom" ? baseUrl.trim() : undefined;
      const nextConfiguration: Record<string, unknown> = {
        ...configurationWithoutReservedFields,
        ...(customChatBaseUrl ? { baseUrl: customChatBaseUrl } : typeof advancedConfiguration.baseUrl === "string" ? { baseUrl: advancedConfiguration.baseUrl } : {}),
        ...(connection ? { connection } : {}),
        ...(nextApiKey ? { apiKey: nextApiKey } : {}),
        ...(provider.source === "custom" && avatarId ? { avatarId } : {}),
      };
      const finalModelIds = Array.isArray(nextConfiguration.models)
        ? nextConfiguration.models.flatMap((model: unknown) => typeof model === "object" && model !== null && !Array.isArray(model) && typeof (model as Record<string, unknown>).id === "string" ? [(model as Record<string, unknown>).id as string] : [])
        : [];
      await client.saveProviderConfiguration(kind, provider.id, nextConfiguration, enabledModelIds?.filter((modelId) => finalModelIds.includes(modelId)));
      await reload();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const addProvider = async (providerId: string, avatarId: ProviderAvatarId) => {
    const configurationForKind = kind === "chat"
      ? { name: providerId, avatarId, baseUrl: "https://", api: "openai-completions", models: [] }
      : { name: providerId, avatarId, baseUrl: "https://", api: "openrouter-images", models: [] };
    setSaving(true);
    setError(null);
    try {
      await client.saveProviderConfiguration(kind, providerId, configurationForKind);
      await reload();
      await refresh();
      setSelectedId(providerId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setSaving(false);
    }
  };

  const setModelEnabled = async (model: ConfiguredModelSummary, enabled: boolean) => {
    const key = modelKey(model.providerId, model.modelId);
    setEnabledOverrides((current) => ({ ...current, [key]: enabled }));
    setError(null);
    try {
      await client.setConfiguredModelEnabled(kind, model.providerId, model.modelId, enabled);
      await reload();
      await refresh();
    } catch (reason) {
      setEnabledOverrides((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const loginWithOAuth = async (provider: ConfiguredProviderSummary) => {
    try {
      setSaving(true);
      setError(null);
      await client.loginProviderOAuth(provider.id);
      await reload();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const deleteProvider = async (provider: ConfiguredProviderSummary) => {
    try {
      setSaving(true);
      setError(null);
      await client.deleteCustomProvider(kind, provider.id);
      setSelectedId(null);
      await reload();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <ProviderSidebar
        addingDisabled={saving}
        kind={kind}
        onAddProvider={addProvider}
        onKindChange={(nextKind) => { setKind(nextKind); setSelectedId(null); setError(null); }}
        onSelectProvider={setSelectedId}
        providers={providers}
        selectedProviderId={selectedProvider?.id ?? null}
      />
      <ProviderConfigurationPanel
        error={error}
        models={models}
        onDelete={deleteProvider}
        onLoginWithOAuth={loginWithOAuth}
        onSave={saveProviderConfiguration}
        onSetModelEnabled={setModelEnabled}
        provider={selectedProvider}
        saving={saving}
      />
    </div>
  );
}
