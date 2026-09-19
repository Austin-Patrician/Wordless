import { Button } from "@wordless/ui-kit";
import { ArrowRight, Check, ChevronLeft, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePreferences } from "../../shared/preferences";
import { useRuntime } from "../../shared/runtime";
import { OnboardingWelcome } from "./OnboardingWelcome";
import {
  findOnboardingAnchor,
  highlightRectOf,
  ONBOARDING_STEPS,
  positionOnboardingCard,
  type HighlightRect,
} from "./onboarding-steps";

type OnboardingPhase = "idle" | "welcome" | "tour";

type OnboardingContextValue = {
  /** True while the welcome screen or the tour is on screen. */
  active: boolean;
  /** Restarts the tour over the current interface, used by the Settings entry. */
  replay: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding() {
  return useContext(OnboardingContext);
}

/**
 * Re-rendering on every measurement would feed the MutationObserver back into
 * itself, so a measurement only updates state when it actually moved.
 */
function sameRect(left: HighlightRect | null, right: HighlightRect | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.top === right.top &&
    left.left === right.left &&
    left.width === right.width &&
    left.height === right.height
  );
}

function stepLabel(template: string, current: number, total: number): string {
  return template.replace("{current}", String(current)).replace("{total}", String(total));
}

/**
 * Runs the first-run guide: a welcome screen that collects language and theme,
 * followed by a spotlight tour of the main interface.
 *
 * The guide is rendered as an overlay so it never has to reach into the
 * workbench's layout logic. The tour only reads anchor elements; when an anchor
 * is missing (a collapsed sidebar, a narrow window, or a hidden element) the
 * step degrades to a centered card instead of failing.
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { client, snapshot, status } = useRuntime();
  const { t } = usePreferences();
  const [phase, setPhase] = useState<OnboardingPhase>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<HighlightRect | null>(null);
  const [cardRect, setCardRect] = useState<HighlightRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ width: 320, height: 190 });
  const checkedRef = useRef(false);

  // The welcome screen writes preferences through the runtime, so it must wait
  // until the runtime is ready; otherwise the user's choices are dropped.
  useEffect(() => {
    if (checkedRef.current || status !== "ready" || !snapshot || !client) return;
    checkedRef.current = true;
    let active = true;
    void client
      .getOnboardingState()
      .then((state) => {
        if (active && state.completedAt === null) setPhase("welcome");
      })
      .catch(() => {
        // A failed read must not block the app: skip the guide silently.
      });
    return () => {
      active = false;
    };
  }, [client, snapshot, status]);

  const finish = useCallback(() => {
    setPhase("idle");
    setRect(null);
    void client?.completeOnboarding().catch(() => {});
  }, [client]);

  const start = useCallback(() => {
    setStepIndex(0);
    setPhase("tour");
  }, []);

  /**
   * Settings entry: clears the host record and reopens the guide from the
   * welcome screen, so the whole first-run experience can be replayed rather
   * than only the spotlight half of it.
   */
  const replay = useCallback(() => {
    setStepIndex(0);
    setPhase("welcome");
    void client?.resetOnboarding().catch(() => {});
  }, [client]);

  const step = ONBOARDING_STEPS[stepIndex];
  const tourActive = phase === "tour" && step !== undefined;

  // Measure the anchor for the active step, and keep it in sync while the user
  // resizes or scrolls the interface underneath.
  useLayoutEffect(() => {
    if (!tourActive) {
      setRect(null);
      setCardRect(null);
      return;
    }
    const measure = () => {
      const anchor = findOnboardingAnchor(step);
      const next = anchor ? highlightRectOf(anchor) : null;
      setRect((current) => (sameRect(current, next) ? current : next));

      // A step may highlight a small control while placing its card against a
      // larger surrounding surface, so the two rects are measured separately.
      const cardAnchor = step.cardAnchors
        ? findOnboardingAnchor({ ...step, anchors: step.cardAnchors })
        : anchor;
      const nextCard = cardAnchor ? highlightRectOf(cardAnchor) : next;
      setCardRect((current) => (sameRect(current, nextCard) ? current : nextCard));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    // Steps target views that mount asynchronously, so re-measure on DOM changes
    // rather than assuming the anchor exists on the first pass.
    const observer = new MutationObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer.disconnect();
    };
  }, [step, tourActive]);

  useLayoutEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    setCardSize((current) =>
      Math.abs(current.width - bounds.width) < 1 && Math.abs(current.height - bounds.height) < 1
        ? current
        : { width: bounds.width, height: bounds.height },
    );
  }, [step, rect, cardRect, phase]);

  const cardPosition = useMemo(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const reference = cardRect ?? rect;
    if (!reference) {
      return positionOnboardingCard({ top: 0, left: 0, width: 0, height: 0 }, "center", cardSize, viewport);
    }
    return positionOnboardingCard(reference, step?.placement ?? "bottom", cardSize, viewport);
  }, [cardRect, cardSize, rect, step]);

  const contextValue = useMemo<OnboardingContextValue>(
    () => ({ active: phase !== "idle", replay }),
    [phase, replay],
  );

  return (
    <OnboardingContext.Provider value={contextValue}>
      {children}
      {phase === "welcome" ? <OnboardingWelcome onSkip={finish} onStart={start} /> : null}

      {tourActive ? (
        <div className="fixed inset-0 z-[140]" role="dialog" aria-modal="true" aria-label={t("onboardingWelcomeTitle")}>
          {/* Scrim blocks interaction with the interface behind the guide. */}
          <div className="absolute inset-0" />
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-[12px] transition-[top,left,width,height] duration-200 ease-out motion-reduce:transition-none"
            style={{
              top: rect?.top ?? 0,
              left: rect?.left ?? 0,
              width: rect?.width ?? 0,
              height: rect?.height ?? 0,
              boxShadow: "0 0 0 9999px rgb(18 19 15 / 0.62)",
            }}
          />
          <div
            className="absolute w-[330px] rounded-[14px] border border-[#e3e3de] bg-white p-4 shadow-[0_20px_48px_rgba(20,20,16,0.24)] dark:border-border dark:bg-card"
            ref={cardRef}
            style={{ top: cardPosition.top, left: cardPosition.left }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1" aria-hidden>
                  {ONBOARDING_STEPS.map((_, index) => (
                    <span
                      className={`h-1 rounded-full transition-all ${index === stepIndex ? "w-3.5 bg-[#6f8250] dark:bg-[#c8df89]" : "w-1 bg-[#dcdcd4] dark:bg-[#3f4239]"}`}
                      key={index}
                    />
                  ))}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {stepLabel(t("onboardingStepProgress"), stepIndex + 1, ONBOARDING_STEPS.length)}
                </span>
              </div>
              <button
                aria-label={t("onboardingSkip")}
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-[#8a8a83] transition-colors hover:bg-[#efefeb] focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-muted"
                onClick={finish}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <h2 className="mt-2.5 text-[14px] font-semibold text-[#232320] dark:text-foreground">
              {t(step.titleKey)}
            </h2>
            <p className="mt-1.5 text-[12px] leading-5 text-[#63635c] dark:text-muted-foreground">
              {t(step.bodyKey)}
            </p>
            <div className="mt-4 flex items-center justify-between">
              <Button
                disabled={stepIndex === 0}
                onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
                size="sm"
                type="button"
                variant="ghost"
              >
                <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                {t("onboardingBack")}
              </Button>
              {stepIndex === ONBOARDING_STEPS.length - 1 ? (
                <Button onClick={finish} size="sm" type="button">
                  <Check className="mr-1 h-3.5 w-3.5" />
                  {t("onboardingFinish")}
                </Button>
              ) : (
                <Button onClick={() => setStepIndex((current) => Math.min(ONBOARDING_STEPS.length - 1, current + 1))} size="sm" type="button">
                  {t("onboardingNext")}
                  <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </OnboardingContext.Provider>
  );
}
