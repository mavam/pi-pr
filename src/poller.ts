import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  PI_PR_PROTOCOL,
  type PullRequestHealth,
  type PullRequestSnapshot,
  type PullRequestStateEvent,
  type PullRequestTarget,
  type ReviewFeedback,
} from "./api.ts";
import { fetchCiStatus } from "./ci.ts";
import {
  type DiscoveredPullRequest,
  currentBranch,
  discoverPullRequest,
} from "./discovery.ts";
import {
  type FeedbackSnapshot,
  type FetchOutcome,
  type ThreadCountSnapshot,
  fetchFeedback,
  fetchThreadCount,
} from "./feedback.ts";

function isFeedbackSnapshot(
  snapshot: FeedbackSnapshot | ThreadCountSnapshot,
): snapshot is FeedbackSnapshot {
  return "feedback" in snapshot;
}

/**
 * Opinionated cadences. pi-pr is the only GitHub poller in a session, so these
 * are deliberately conservative; configuration comes later.
 */
const IDLE_INTERVAL_MS = 60_000;
const WATCH_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 300_000;

export interface PollerOptions {
  pi: ExtensionAPI;
  onState: (state: PullRequestStateEvent) => void;
  onFeedback: (target: PullRequestTarget, feedback: ReviewFeedback[]) => void;
}

export interface WatchResult {
  ok: boolean;
  target?: PullRequestTarget;
  error?: string;
}

export interface Poller {
  start(cwd: string): void;
  stop(): void;
  setCwd(cwd: string): void;
  watch(cwd: string): Promise<WatchResult>;
  unwatch(): boolean;
  isWatching(): boolean;
  currentState(): PullRequestStateEvent | undefined;
}

export function createPoller(options: PollerOptions): Poller {
  const { pi, onState, onFeedback } = options;

  let active = false;
  let cwd = process.cwd();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cycleRunning = false;
  let failures = 0;

  let branch = "";
  let repository = "";
  let discovered: DiscoveredPullRequest | undefined;
  let watching = false;
  let seen = new Set<string>();
  let state: PullRequestStateEvent | undefined;
  let ciStatus: PullRequestSnapshot["ci"];
  let unresolvedThreadCount = 0;

  const clearTarget = (): void => {
    discovered = undefined;
    watching = false;
    seen = new Set<string>();
  };

  const publish = (health: PullRequestHealth): void => {
    const pullRequest: PullRequestSnapshot | undefined = discovered
      ? {
          target: discovered.target,
          lifecycle: discovered.lifecycle,
          isDraft: discovered.isDraft,
          autoMergeEnabled: discovered.autoMergeEnabled,
          headRefOid: discovered.headRefOid,
          ...(ciStatus ? { ci: ciStatus } : {}),
          unresolvedThreadCount,
          watching,
        }
      : undefined;

    state = {
      protocol: PI_PR_PROTOCOL,
      source: "pi-pr",
      repository,
      branch,
      health,
      ...(pullRequest ? { pullRequest } : {}),
      updatedAt: Date.now(),
    };
    onState(state);
  };

  const schedule = (health: PullRequestHealth): void => {
    if (!active) return;
    if (timer) clearTimeout(timer);

    const base = watching ? WATCH_INTERVAL_MS : IDLE_INTERVAL_MS;
    const delay =
      health === "ok"
        ? base
        : Math.min(base * 2 ** Math.min(failures, 5), MAX_BACKOFF_MS);
    timer = setTimeout(() => {
      void cycle();
    }, delay);
  };

  /** One poll: resolve the pull request, refresh its state, publish. */
  const cycle = async (): Promise<void> => {
    if (!active || cycleRunning) return;
    cycleRunning = true;
    const pollCwd = cwd;

    try {
      const nextBranch = await currentBranch(pi, pollCwd);
      if (!active) return;
      if (nextBranch !== branch || pollCwd !== cwd) {
        branch = nextBranch;
        clearTarget();
      }

      if (!branch) {
        repository = "";
        ciStatus = undefined;
        unresolvedThreadCount = 0;
        failures = 0;
        publish("ok");
        schedule("ok");
        return;
      }

      if (!discovered) {
        const result = await discoverPullRequest(pi, pollCwd, branch);
        if (!active || pollCwd !== cwd) return;
        repository = result.repository;
        discovered = result.pullRequest;
        if (!discovered) {
          ciStatus = undefined;
          unresolvedThreadCount = 0;
          const health: PullRequestHealth = result.authFailed
            ? "unauthenticated"
            : "ok";
          failures = result.authFailed ? failures + 1 : 0;
          publish(health);
          schedule(health);
          return;
        }
      }

      const target = discovered.target;
      const [ci, threads] = await Promise.all([
        fetchCiStatus(pi, pollCwd, target.url),
        (watching
          ? fetchFeedback(pi, pollCwd, target)
          : fetchThreadCount(pi, pollCwd, target)) as Promise<
          FetchOutcome<FeedbackSnapshot | ThreadCountSnapshot>
        >,
      ]);
      if (!active || pollCwd !== cwd || discovered?.target.url !== target.url) {
        return;
      }

      if (!threads.value) {
        failures += 1;
        const health: PullRequestHealth = threads.authFailed
          ? "unauthenticated"
          : "error";
        publish(health);
        schedule(health);
        return;
      }

      failures = 0;
      ciStatus = ci;
      unresolvedThreadCount = threads.value.unresolvedThreadCount;
      if (threads.value.lifecycle) discovered.lifecycle = threads.value.lifecycle;

      if (isFeedbackSnapshot(threads.value)) {
        const snapshot = threads.value;
        const fresh = snapshot.feedback.filter((item) => !seen.has(item.id));
        for (const item of snapshot.feedback) seen.add(item.id);
        const external = fresh.filter(
          (item) => !snapshot.viewerLogin || item.author !== snapshot.viewerLogin,
        );
        if (external.length > 0) onFeedback(target, external);
      }

      // Watching a pull request ends when the pull request does.
      if (watching && discovered.lifecycle !== "open") watching = false;

      publish("ok");
      schedule("ok");
    } finally {
      cycleRunning = false;
    }
  };

  return {
    start: (nextCwd) => {
      active = true;
      cwd = nextCwd;
      branch = "";
      repository = "";
      clearTarget();
      void cycle();
    },
    stop: () => {
      active = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
      clearTarget();
      state = undefined;
    },
    setCwd: (nextCwd) => {
      if (nextCwd === cwd) return;
      cwd = nextCwd;
      branch = "";
      clearTarget();
    },
    watch: async (nextCwd) => {
      active = true;
      cwd = nextCwd;

      const nextBranch = await currentBranch(pi, nextCwd);
      if (!nextBranch) {
        return { ok: false, error: "No branch is checked out" };
      }
      if (nextBranch !== branch) {
        branch = nextBranch;
        clearTarget();
      }

      if (!discovered) {
        const result = await discoverPullRequest(pi, nextCwd, branch);
        repository = result.repository;
        discovered = result.pullRequest;
      }
      if (!discovered) {
        return {
          ok: false,
          error: "No pull request found for the current branch",
        };
      }
      if (discovered.lifecycle !== "open") {
        return { ok: false, error: `The pull request is ${discovered.lifecycle}` };
      }

      const target = discovered.target;
      const snapshot = await fetchFeedback(pi, nextCwd, target);
      if (!snapshot.value) {
        return {
          ok: false,
          error: snapshot.authFailed
            ? "GitHub authentication failed; run gh auth login"
            : "Failed to read pull request feedback from GitHub",
        };
      }

      watching = true;
      unresolvedThreadCount = snapshot.value.unresolvedThreadCount;
      seen = new Set(snapshot.value.feedback.map((item) => item.id));
      ciStatus = await fetchCiStatus(pi, nextCwd, target.url);

      publish("ok");
      if (snapshot.value.openFeedback.length > 0) {
        onFeedback(target, snapshot.value.openFeedback);
      }
      schedule("ok");
      return { ok: true, target };
    },
    unwatch: () => {
      if (!watching) return false;
      watching = false;
      publish("ok");
      schedule("ok");
      return true;
    },
    isWatching: () => watching,
    currentState: () => state,
  };
}
