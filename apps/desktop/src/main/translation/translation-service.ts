import type { DesktopHostEvent, TranslationStreamEvent } from "@wordless/protocol";
import type { WordlessRuntime } from "@wordless/runtime";

/**
 * Coalescing window for streamed translation deltas.
 *
 * A provider can emit hundreds of small deltas for one paragraph. Forwarding
 * each one over IPC would flood the channel for no perceptible benefit, so
 * deltas are batched on this cadence before being sent.
 */
const DELTA_FLUSH_MS = 60;

type TranslationRequest = {
  requestId: string;
  sessionId: string;
  text: string;
  targetLanguage?: string;
};

/**
 * Owns in-flight selection translations.
 *
 * Translations run outside the Agent loop, so they must not touch the session
 * journal. Progress therefore travels as host events, and this service is the
 * authority on which requests are alive: every stream is reachable through the
 * registry, so closing a bubble, switching sessions, or quitting the app can
 * always cancel the work instead of leaving it to burn tokens.
 */
export class DesktopTranslationService {
  private readonly active = new Map<string, AbortController>();
  private readonly pending = new Map<string, string>();
  private readonly accumulated = new Map<string, string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly options: {
    getRuntime: () => WordlessRuntime | undefined;
    send: (event: Extract<DesktopHostEvent, { type: "translation" }>) => void;
  };

  constructor(options: {
    getRuntime: () => WordlessRuntime | undefined;
    send: (event: Extract<DesktopHostEvent, { type: "translation" }>) => void;
  }) {
    this.options = options;
  }

  get activeCount(): number {
    return this.active.size;
  }

  /** Starts a translation and returns immediately; progress arrives as events. */
  start(request: TranslationRequest): void {
    if (this.active.has(request.requestId)) throw new Error("A translation with this request id is already running");
    const runtime = this.options.getRuntime();
    if (!runtime) throw new Error("The runtime is not available yet");
    const controller = new AbortController();
    this.active.set(request.requestId, controller);
    void this.run(runtime, request, controller);
  }

  /** Cancels one request. Unknown ids are ignored so late aborts are harmless. */
  abort(requestId: string): void {
    this.active.get(requestId)?.abort();
  }

  dispose(): void {
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
    this.accumulated.clear();
  }

  private async run(runtime: WordlessRuntime, request: TranslationRequest, controller: AbortController): Promise<void> {
    const { requestId } = request;
    try {
      const start = await runtime.resolveTranslationTarget({
        sessionId: request.sessionId,
        ...(request.targetLanguage ? { targetLanguage: request.targetLanguage } : {}),
      });
      if (controller.signal.aborted) {
        this.emit({ requestId, phase: "aborted", text: "" });
        return;
      }
      this.emit({
        requestId,
        phase: "start",
        text: "",
        targetLanguage: start.targetLanguage,
        model: start.model,
      });
      const result = await runtime.translateSelection(
        {
          sessionId: request.sessionId,
          text: request.text,
          targetLanguage: start.targetLanguage,
          signal: controller.signal,
        },
        (delta) => this.queueDelta(requestId, delta),
      );
      this.flush(requestId);
      // A provider that ignores the abort signal still resolves. The user asked
      // to stop, so the partial text is reported as aborted rather than done.
      if (controller.signal.aborted) {
        this.emit({ requestId, phase: "aborted", text: this.accumulated.get(requestId) ?? "" });
      } else {
        this.emit({ requestId, phase: "done", text: result.text, targetLanguage: result.targetLanguage, model: result.model });
      }
    } catch (error) {
      this.flush(requestId);
      if (controller.signal.aborted) {
        this.emit({ requestId, phase: "aborted", text: this.accumulated.get(requestId) ?? "" });
      } else {
        this.emit({ requestId, phase: "error", text: "", error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      this.clearTimer(requestId);
      this.pending.delete(requestId);
      this.accumulated.delete(requestId);
      this.active.delete(requestId);
    }
  }

  private queueDelta(requestId: string, delta: string): void {
    this.pending.set(requestId, (this.pending.get(requestId) ?? "") + delta);
    this.accumulated.set(requestId, (this.accumulated.get(requestId) ?? "") + delta);
    if (this.timers.has(requestId)) return;
    this.timers.set(
      requestId,
      setTimeout(() => {
        this.timers.delete(requestId);
        this.flush(requestId);
      }, DELTA_FLUSH_MS),
    );
  }

  private flush(requestId: string): void {
    const buffered = this.pending.get(requestId);
    this.pending.delete(requestId);
    if (!buffered) return;
    this.emit({ requestId, phase: "delta", text: buffered });
  }

  private clearTimer(requestId: string): void {
    const timer = this.timers.get(requestId);
    if (timer) clearTimeout(timer);
    this.timers.delete(requestId);
  }

  private emit(event: TranslationStreamEvent): void {
    this.options.send({ type: "translation", event });
  }
}
