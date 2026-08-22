import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PullRequestCiState, PullRequestCiStatus } from "./api.ts";
import { gh } from "./exec.ts";

interface PullRequestCheck {
  state: PullRequestCiState;
  url: string;
  startedAt: string;
  completedAt: string;
}

const CHECK_BUCKET_STATES = new Map<string, PullRequestCiState>([
  ["fail", "failed"],
  ["cancel", "failed"],
  ["pending", "running"],
  ["pass", "okay"],
  ["skipping", "okay"],
]);

function parsePullRequestChecks(output: string): PullRequestCheck[] | undefined {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (!Array.isArray(parsed)) return undefined;

    const checks: PullRequestCheck[] = [];
    for (const value of parsed) {
      if (typeof value !== "object" || value === null) return undefined;
      const check = value as Record<string, unknown>;
      if (typeof check.bucket !== "string") return undefined;
      const state = CHECK_BUCKET_STATES.get(check.bucket);
      if (!state) return undefined;

      checks.push({
        state,
        url: typeof check.link === "string" ? check.link : "",
        startedAt: typeof check.startedAt === "string" ? check.startedAt : "",
        completedAt:
          typeof check.completedAt === "string" ? check.completedAt : "",
      });
    }
    return checks;
  } catch {
    return undefined;
  }
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function newestFirst(checks: PullRequestCheck[]): PullRequestCheck[] {
  return [...checks].sort((left, right) => {
    const leftAt = timestamp(left.completedAt) || timestamp(left.startedAt);
    const rightAt = timestamp(right.completedAt) || timestamp(right.startedAt);
    return rightAt - leftAt;
  });
}

export function selectCiStatus(
  output: string,
  pullRequestUrl = "",
): PullRequestCiStatus | undefined {
  const checks = parsePullRequestChecks(output);
  if (!checks || checks.length === 0) return undefined;

  const newest = newestFirst(checks);
  const selected =
    newest.find((check) => check.state === "failed") ??
    newest.find((check) => check.state === "running") ??
    newest[0]!;
  return { state: selected.state, url: selected.url || pullRequestUrl };
}

export async function fetchCiStatus(
  pi: ExtensionAPI,
  cwd: string,
  pullRequestUrl: string,
): Promise<PullRequestCiStatus | undefined> {
  const result = await gh(
    pi,
    ["pr", "checks", pullRequestUrl, "--json", "bucket,link,startedAt,completedAt"],
    cwd,
  );
  if (!result.stdout) return undefined;
  return selectCiStatus(result.stdout, pullRequestUrl);
}
