export type ThreadFollowMode = "following" | "paused";
export type ThreadViewportSnapshot = {
  activeTurnId: string | null;
  atBottom: boolean;
  followMode: ThreadFollowMode;
  showJumpToLatest: boolean;
};

export type AnimationFrameScheduler = {
  cancel: (handle: number) => void;
  request: (callback: FrameRequestCallback) => number;
};

const browserFrameScheduler: AnimationFrameScheduler = {
  cancel: (handle) => window.cancelAnimationFrame(handle),
  request: (callback) => window.requestAnimationFrame(callback),
};

export class ThreadViewportStore {
  private activeTurnId: string | null = null;
  private atBottom = false;
  private followMode: ThreadFollowMode = "following";
  private initializing = true;
  private frame: number | null = null;
  private pendingUserScrollIntent = false;
  private explicitPauseActive = false;
  private readonly listeners = new Set<() => void>();
  private snapshot: ThreadViewportSnapshot = {
    activeTurnId: null,
    atBottom: false,
    followMode: "following",
    showJumpToLatest: false,
  };
  private readonly scheduler: AnimationFrameScheduler;

  constructor(scheduler: AnimationFrameScheduler = browserFrameScheduler) {
    this.scheduler = scheduler;
  }

  readonly getSnapshot = (): ThreadViewportSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  shouldFollowTailGrowth(): boolean {
    return this.followMode === "following" && !this.pendingUserScrollIntent;
  }

  markUserScrollIntent(): void {
    this.pendingUserScrollIntent = true;
  }

  clearUserScrollIntent(): void {
    this.pendingUserScrollIntent = false;
  }

  setAtBottom(atBottom: boolean): void {
    this.atBottom = atBottom;
    if (atBottom) {
      this.pendingUserScrollIntent = false;
      this.initializing = false;
      if (!this.explicitPauseActive)
        this.followMode = "following";
    } else if (this.initializing) {
      this.initializing = false;
      this.followMode = "paused";
    } else if (this.pendingUserScrollIntent) {
      this.pendingUserScrollIntent = false;
      this.followMode = "paused";
    }
    this.schedulePublish();
  }

  setActiveTurn(turnId: string | null): void {
    if (this.activeTurnId === turnId) return;
    this.activeTurnId = turnId;
    this.schedulePublish();
  }

  pauseFollowing(): void {
    this.pendingUserScrollIntent = false;
    this.explicitPauseActive = true;
    this.initializing = false;
    this.followMode = "paused";
    this.atBottom = false;
    this.schedulePublish();
  }

  resumeFollowing(): void {
    this.pendingUserScrollIntent = false;
    this.explicitPauseActive = false;
    this.initializing = false;
    this.followMode = "following";
    this.atBottom = true;
    this.schedulePublish();
  }

  dispose(): void {
    if (this.frame !== null) this.scheduler.cancel(this.frame);
    this.frame = null;
    this.listeners.clear();
  }

  private schedulePublish(): void {
    if (this.frame !== null) return;
    this.frame = this.scheduler.request(() => {
      this.frame = null;
      this.publish();
    });
  }

  private publish(): void {
    const next: ThreadViewportSnapshot = {
      activeTurnId: this.activeTurnId,
      atBottom: this.atBottom,
      followMode: this.followMode,
      showJumpToLatest: this.followMode === "paused" && !this.initializing,
    };
    if (
      next.activeTurnId === this.snapshot.activeTurnId &&
      next.atBottom === this.snapshot.atBottom &&
      next.followMode === this.snapshot.followMode &&
      next.showJumpToLatest === this.snapshot.showJumpToLatest
    )
      return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
