import type { AgentProfileDefinition } from "@wordless/agent-driver-sdk";
import type { ProfileReference } from "@wordless/domain";

export type ProfileDefinition = AgentProfileDefinition;

export interface ProfileRegistry {
  get(reference: ProfileReference): ProfileDefinition | undefined;
  list(): ProfileDefinition[];
}

export function createProfileRegistry(definitions: ProfileDefinition[]): ProfileRegistry {
  const profiles = new Map(definitions.map((definition) => [`${definition.reference.id}@${definition.reference.version}`, definition]));

  return {
    get(reference) {
      return profiles.get(`${reference.id}@${reference.version}`);
    },
    list() {
      return [...profiles.values()];
    },
  };
}
