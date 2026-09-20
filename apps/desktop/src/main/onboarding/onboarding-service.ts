import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OnboardingState } from "@wordless/protocol";

/**
 * Bump this when the guide gains or changes meaningful steps: a record written
 * for an older revision is treated as incomplete, so existing installations are
 * walked through the new material once.
 */
export const ONBOARDING_VERSION = 1;

function defaultState(): OnboardingState {
  return { version: ONBOARDING_VERSION, completedAt: null };
}

/**
 * Tracks whether the first-run guide has been completed. The record lives next
 * to the rest of the host data so it survives renderer storage resets, which is
 * what makes it reliable for a "show this once per installation" decision.
 */
export class OnboardingService {
  private readonly statePath: string;

  constructor(userDataPath: string) {
    this.statePath = path.join(userDataPath, "onboarding.json");
  }

  async read(): Promise<OnboardingState> {
    let stored: unknown;
    try {
      stored = JSON.parse(await readFile(this.statePath, "utf8"));
    } catch {
      // A missing or unreadable record means the guide has not been completed.
      return defaultState();
    }
    if (typeof stored !== "object" || stored === null) return defaultState();
    const record = stored as Record<string, unknown>;
    if (record.version !== ONBOARDING_VERSION) return defaultState();
    return {
      version: ONBOARDING_VERSION,
      completedAt: typeof record.completedAt === "number" ? record.completedAt : null,
    };
  }

  async complete(): Promise<OnboardingState> {
    return await this.write({ version: ONBOARDING_VERSION, completedAt: Date.now() });
  }

  async reset(): Promise<OnboardingState> {
    return await this.write(defaultState());
  }

  private async write(state: OnboardingState): Promise<OnboardingState> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return state;
  }
}
