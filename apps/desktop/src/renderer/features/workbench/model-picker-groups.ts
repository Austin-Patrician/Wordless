import type { EnabledModelRecord, ProviderAvatarId, ProviderConnectionRecord } from "@wordless/domain";

/**
 * Grouping and filtering for the model picker, kept apart from the component so the
 * parts that can be wrong are testable — the picker itself has no test coverage of
 * its own.
 *
 * **Grouped by the configured provider, not by model family.** There is already a
 * `groupProviderModels` helper in the settings feature that infers a vendor from the
 * model id with a regex table (`claude` → Anthropic, `glm` → Zhipu). That is right for
 * the discovery dialog, which browses one aggregator's catalogue of hundreds of
 * vendors' models. It is wrong here: the user configured these providers by name
 * (`hyb`, `wong`, `routin-glm`), so a header reading "Zhipu / Z.AI" would not match
 * anything they set up, and the icon would disagree with the settings page.
 */

export type ModelPickerGroup = {
  /** The provider id — which is also what `EnabledModelRecord.connectionId` holds. */
  id: string;
  /** The name the user gave this provider, falling back to its id. */
  label: string;
  avatarId: ProviderAvatarId | null;
  /**
   * False when this provider's credentials are not usable, which disables its rows.
   *
   * Resolved here because the group already looks the connection up; a missing
   * connection counts as unconfigured, matching how the flat list treated a model
   * whose connection it could not find.
   */
  configured: boolean;
  models: EnabledModelRecord[];
};

/**
 * Groups enabled models under the provider each belongs to.
 *
 * Order is the user's own, not alphabetical: groups follow the order of
 * `connections` (the same order the settings sidebar lists them in), and models keep
 * the order they were handed in. Sorting either alphabetically would scramble names
 * the user chose — and on a real profile several providers expose the *same* model id
 * (`glm-5.3-flash` under four different endpoints), so the grouping is also what tells
 * those rows apart.
 */
export function modelPickerGroups(
  models: EnabledModelRecord[],
  connections: ProviderConnectionRecord[],
): ModelPickerGroup[] {
  const byProvider = new Map<string, ModelPickerGroup>();
  for (const model of models) {
    const id = model.connectionId;
    const existing = byProvider.get(id);
    if (existing) {
      existing.models.push(model);
      continue;
    }
    const connection = connections.find((candidate) => candidate.id === id);
    byProvider.set(id, {
      id,
      label: connection?.displayName?.trim() || id,
      avatarId: connection?.avatarId ?? null,
      configured: connection?.authStatus === "configured",
      models: [model],
    });
  }

  // Configured order first. A provider the snapshot does not describe — which happens
  // for a model whose connection was removed — keeps its first-appearance position
  // after the known ones rather than being dropped.
  const configured = new Map(connections.map((connection, index) => [connection.id, index]));
  return [...byProvider.values()].sort((left, right) => {
    const leftIndex = configured.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = configured.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * Narrows groups to what matches a search query.
 *
 * A query that matches the **provider** keeps all of that provider's models: the
 * names here are descriptive (`routin-glm`, `hybclaude`), so typing `glm` should
 * bring up the whole group rather than only the rows that happen to spell it out.
 * Groups left with nothing are dropped, so no empty header is rendered.
 */
export function filterModelPickerGroups(groups: ModelPickerGroup[], query: string): ModelPickerGroup[] {
  const needle = normalize(query);
  if (!needle) return groups;

  const filtered: ModelPickerGroup[] = [];
  for (const group of groups) {
    const providerMatches = [group.label, group.id].some((value) => normalize(value).includes(needle));
    if (providerMatches) {
      filtered.push(group);
      continue;
    }
    const models = group.models.filter((model) =>
      [model.displayName, model.modelId].some((value) => normalize(value).includes(needle)),
    );
    if (models.length > 0) filtered.push({ ...group, models });
  }
  return filtered;
}

/** Total models across groups, for the empty-state check. */
export function countModelPickerModels(groups: ModelPickerGroup[]): number {
  return groups.reduce((total, group) => total + group.models.length, 0);
}
