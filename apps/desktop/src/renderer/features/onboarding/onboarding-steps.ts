import type { MessageKey } from "../../shared/i18n";

/** Where the explanation card sits relative to the highlighted element. */
export type OnboardingPlacement = "right" | "top" | "bottom" | "center";

export type OnboardingStepId =
  | "new-thread"
  | "composer"
  | "model"
  | "skills-mcp"
  | "workspace"
  | "tasks-experts"
  | "settings";

export type OnboardingStep = {
  id: OnboardingStepId;
  titleKey: MessageKey;
  bodyKey: MessageKey;
  /**
   * Selectors tried in order; the first element that exists wins. The guide runs
   * over a live interface whose layout depends on window size and sidebar state,
   * so every step needs a fallback rather than a single brittle selector.
   */
  anchors: readonly string[];
  /**
   * Selectors used only to position the card, when highlighting the control
   * itself would trap the card inside its surrounding surface. The model pill
   * lives inside the composer, so highlighting the pill while placing the card
   * against the composer keeps the explanation off the input area.
   */
  cardAnchors?: readonly string[];
  placement: Exclude<OnboardingPlacement, "center">;
};

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "new-thread",
    titleKey: "onboardingStepNewThreadTitle",
    bodyKey: "onboardingStepNewThreadBody",
    anchors: ['[data-tour="nav-new"]'],
    placement: "right",
  },
  {
    id: "workspace",
    titleKey: "onboardingStepWorkspaceTitle",
    bodyKey: "onboardingStepWorkspaceBody",
    anchors: ['[data-tour="welcome-workspace"]', '[data-tour="side-workspaces"]'],
    placement: "top",
  },
  {
    id: "model",
    titleKey: "onboardingStepModelTitle",
    bodyKey: "onboardingStepModelBody",
    // Highlight the model selector in the composer footer, but place the card
    // against the composer itself so it does not cover the input area.
    anchors: ['[data-tour="composer-model"]'],
    cardAnchors: ['[data-tour="composer"]'],
    placement: "top",
  },
  {
    id: "composer",
    titleKey: "onboardingStepComposerTitle",
    bodyKey: "onboardingStepComposerBody",
    anchors: ['[data-tour="composer"]'],
    placement: "top",
  },
  {
    id: "skills-mcp",
    titleKey: "onboardingStepSkillsTitle",
    bodyKey: "onboardingStepSkillsBody",
    anchors: ['[data-tour="nav-skills"]'],
    placement: "right",
  },
  {
    id: "tasks-experts",
    titleKey: "onboardingStepTasksTitle",
    bodyKey: "onboardingStepTasksBody",
    anchors: ['[data-tour="nav-tasks"]', '[data-tour="nav-experts"]'],
    placement: "right",
  },
  {
    id: "settings",
    titleKey: "onboardingStepSettingsTitle",
    bodyKey: "onboardingStepSettingsBody",
    anchors: ['[data-tour="sidebar-settings"]', '[data-tour="header-settings"]'],
    placement: "top",
  },
];

/** Distance kept between the highlighted element and the card. */
export const ONBOARDING_CARD_GAP = 14;
/** Padding added around the highlighted element so it does not look clipped. */
export const ONBOARDING_HIGHLIGHT_PADDING = 6;

export type HighlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

/**
 * An element with `display: contents`, or one hidden by `hidden`/`display: none`,
 * has no layout box and reports a zero rect. Highlighting such an element would
 * collapse the spotlight into the corner of the window, so such anchors are
 * treated as unavailable and the next selector is tried.
 */
export function isMeasurableAnchor(element: Element): boolean {
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
}

/**
 * Finds the element a step should highlight. Returns null when none of the
 * selectors match, which happens on narrow layouts where the sidebar is hidden,
 * when a step's host view is not mounted, or when every match is unmeasurable.
 */
export function findOnboardingAnchor(
  step: OnboardingStep,
  root: Pick<Document, "querySelector"> = document,
  isUsable: (element: Element) => boolean = isMeasurableAnchor,
): Element | null {
  for (const selector of step.anchors) {
    const element = root.querySelector(selector);
    if (element && isUsable(element)) return element;
  }
  return null;
}

export function highlightRectOf(element: Element, padding = ONBOARDING_HIGHLIGHT_PADDING): HighlightRect {
  const bounds = element.getBoundingClientRect();
  return {
    top: bounds.top - padding,
    left: bounds.left - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

export type CardPosition = { top: number; left: number };

/**
 * Places the card next to the highlighted element, clamped to the viewport so it
 * stays reachable for anchors that sit against an edge.
 */
export function positionOnboardingCard(
  rect: HighlightRect,
  placement: OnboardingPlacement,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): CardPosition {
  const margin = 12;
  // Clamp against the card's own size, not just the viewport, or a wide card
  // anchored near the right edge would render past the screen.
  const maxLeft = Math.max(margin, viewport.width - card.width - margin);
  const maxTop = Math.max(margin, viewport.height - card.height - margin);
  const clampX = (value: number) => Math.max(margin, Math.min(value, maxLeft));
  const clampY = (value: number) => Math.max(margin, Math.min(value, maxTop));

  if (placement === "center") {
    return {
      top: clampY((viewport.height - card.height) / 2),
      left: clampX((viewport.width - card.width) / 2),
    };
  }
  if (placement === "right") {
    return {
      top: clampY(rect.top + rect.height / 2 - card.height / 2),
      left: clampX(rect.left + rect.width + ONBOARDING_CARD_GAP),
    };
  }
  if (placement === "top") {
    return {
      top: clampY(rect.top - card.height - ONBOARDING_CARD_GAP),
      left: clampX(rect.left + rect.width / 2 - card.width / 2),
    };
  }
  return {
    top: clampY(rect.top + rect.height + ONBOARDING_CARD_GAP),
    left: clampX(rect.left + rect.width / 2 - card.width / 2),
  };
}
