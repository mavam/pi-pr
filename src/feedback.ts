import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  FeedbackKind,
  PullRequestLifecycle,
  PullRequestTarget,
  ReviewFeedback,
} from "./api.ts";
import { gh, isAuthFailure } from "./exec.ts";
import { parseLifecycle } from "./discovery.ts";
import { reviewContentFrom } from "./markdown.ts";

const MAX_REVIEW_THREAD_PAGES = 10;

/** Counts unresolved review threads without paying for comment bodies. */
const THREAD_COUNT_QUERY = [
  "query($owner: String!, $name: String!, $number: Int!, $after: String) {",
  "  repository(owner: $owner, name: $name) {",
  "    pullRequest(number: $number) {",
  "      state",
  "      reviewThreads(first: 100, after: $after) {",
  "        pageInfo { hasNextPage endCursor }",
  "        nodes { isResolved }",
  "      }",
  "    }",
  "  }",
  "}",
].join(" ");

/** Full review feedback, fetched only while watching. */
const FEEDBACK_QUERY = [
  "query($owner: String!, $name: String!, $number: Int!) {",
  "  viewer { login }",
  "  repository(owner: $owner, name: $name) {",
  "    pullRequest(number: $number) {",
  "      state",
  "      url",
  "      comments(last: 100) {",
  "        nodes { id body bodyHTML createdAt updatedAt url author { login } }",
  "      }",
  "      reviews(last: 100) {",
  "        nodes {",
  "          id body bodyHTML submittedAt updatedAt url state author { login }",
  "          commit { oid }",
  "        }",
  "      }",
  "      reviewThreads(last: 100) {",
  "        nodes {",
  "          id isResolved path line originalLine",
  "          comments(last: 100) {",
  "            nodes {",
  "              id body bodyHTML createdAt updatedAt url path line originalLine diffHunk",
  "              author { login }",
  "              pullRequestReview { commit { oid } }",
  "            }",
  "          }",
  "        }",
  "      }",
  "    }",
  "  }",
  "}",
].join(" ");

export interface FeedbackSnapshot {
  lifecycle: PullRequestLifecycle | undefined;
  viewerLogin: string;
  feedback: ReviewFeedback[];
  openFeedback: ReviewFeedback[];
  unresolvedThreadCount: number;
}

export interface ThreadCountSnapshot {
  lifecycle: PullRequestLifecycle | undefined;
  unresolvedThreadCount: number;
}

interface GraphQlAuthor {
  login?: unknown;
}

interface GraphQlCommit {
  oid?: unknown;
}

interface GraphQlComment {
  id?: unknown;
  body?: unknown;
  bodyHTML?: unknown;
  createdAt?: unknown;
  submittedAt?: unknown;
  updatedAt?: unknown;
  url?: unknown;
  path?: unknown;
  line?: unknown;
  originalLine?: unknown;
  diffHunk?: unknown;
  author?: GraphQlAuthor | null;
  commit?: GraphQlCommit | null;
  pullRequestReview?: { commit?: GraphQlCommit | null } | null;
}

interface GraphQlThread {
  isResolved?: unknown;
  path?: unknown;
  line?: unknown;
  originalLine?: unknown;
  comments?: { nodes?: Array<GraphQlComment | null> | null } | null;
}

export interface GraphQlResponse {
  data?: {
    viewer?: { login?: unknown } | null;
    repository?: {
      pullRequest?: {
        state?: unknown;
        url?: unknown;
        comments?: { nodes?: Array<GraphQlComment | null> | null } | null;
        reviews?: { nodes?: Array<GraphQlComment | null> | null } | null;
        reviewThreads?: { nodes?: Array<GraphQlThread | null> | null } | null;
      } | null;
    } | null;
  };
}

export function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : undefined;
}

function timestampFrom(comment: GraphQlComment): string {
  return (
    cleanText(comment.createdAt) ||
    cleanText(comment.submittedAt) ||
    cleanText(comment.updatedAt)
  );
}

function parseComment(
  comment: GraphQlComment,
  kind: FeedbackKind,
  fallbackLocation?: { path?: string; line?: number; originalLine?: number },
): ReviewFeedback | undefined {
  const id = cleanText(comment.id);
  const author = cleanText(comment.author?.login) || "ghost";
  const content = reviewContentFrom(
    cleanText(comment.body),
    cleanText(comment.bodyHTML),
    author,
    kind === "review",
  );
  const url = cleanText(comment.url);
  if (!id || (!content.body && !content.title) || !url) return undefined;

  const path = cleanText(comment.path) || fallbackLocation?.path;
  const diffLine = numberFrom(comment.line) ?? fallbackLocation?.line;
  const line =
    diffLine ??
    numberFrom(comment.originalLine) ??
    fallbackLocation?.originalLine;
  const diffHunk = cleanText(comment.diffHunk);
  const reviewedCommit =
    cleanText(comment.pullRequestReview?.commit?.oid) ||
    cleanText(comment.commit?.oid);

  return {
    id,
    kind,
    author,
    body: content.body,
    url,
    createdAt: timestampFrom(comment),
    ...(content.priority ? { priority: content.priority } : {}),
    ...(content.title ? { title: content.title } : {}),
    ...(reviewedCommit ? { reviewedCommit } : {}),
    ...(path ? { path } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(diffLine !== undefined ? { diffLine } : {}),
    ...(diffHunk ? { diffHunk } : {}),
  };
}

export function parseFeedbackSnapshot(
  response: GraphQlResponse,
): FeedbackSnapshot | undefined {
  const pullRequest = response.data?.repository?.pullRequest;
  if (!pullRequest) return undefined;

  const feedback: ReviewFeedback[] = [];
  const openFeedback: ReviewFeedback[] = [];
  let unresolvedThreadCount = 0;

  for (const comment of pullRequest.comments?.nodes ?? []) {
    if (!comment) continue;
    const parsed = parseComment(comment, "conversation");
    if (parsed) feedback.push(parsed);
  }

  for (const review of pullRequest.reviews?.nodes ?? []) {
    if (!review) continue;
    const parsed = parseComment(review, "review");
    if (parsed) feedback.push(parsed);
  }

  for (const thread of pullRequest.reviewThreads?.nodes ?? []) {
    if (!thread) continue;
    if (thread.isResolved === false) unresolvedThreadCount += 1;
    const fallbackLocation = {
      path: cleanText(thread.path) || undefined,
      line: numberFrom(thread.line),
      originalLine: numberFrom(thread.originalLine),
    };
    for (const comment of thread.comments?.nodes ?? []) {
      if (!comment) continue;
      const parsed = parseComment(comment, "inline", fallbackLocation);
      if (parsed) {
        feedback.push(parsed);
        if (thread.isResolved === false) openFeedback.push(parsed);
      }
    }
  }

  const compare = (left: ReviewFeedback, right: ReviewFeedback) =>
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id);
  feedback.sort(compare);
  openFeedback.sort(compare);

  return {
    lifecycle: parseLifecycle(pullRequest.state),
    viewerLogin: cleanText(response.data?.viewer?.login),
    feedback,
    openFeedback,
    unresolvedThreadCount,
  };
}

export function parseThreadCountPage(output: string):
  | {
      lifecycle: PullRequestLifecycle | undefined;
      unresolvedCount: number;
      hasNextPage: boolean;
      endCursor: string;
    }
  | undefined {
  try {
    const parsed = JSON.parse(output) as {
      data?: {
        repository?: {
          pullRequest?: {
            state?: unknown;
            reviewThreads?: {
              pageInfo?: { hasNextPage?: unknown; endCursor?: unknown };
              nodes?: Array<{ isResolved?: unknown }>;
            };
          } | null;
        } | null;
      };
    };

    const pullRequest = parsed?.data?.repository?.pullRequest;
    const nodes = pullRequest?.reviewThreads?.nodes;
    if (!Array.isArray(nodes)) return undefined;

    return {
      lifecycle: parseLifecycle(pullRequest?.state),
      unresolvedCount: nodes.filter((node) => node?.isResolved === false).length,
      hasNextPage: pullRequest?.reviewThreads?.pageInfo?.hasNextPage === true,
      endCursor:
        typeof pullRequest?.reviewThreads?.pageInfo?.endCursor === "string"
          ? pullRequest.reviewThreads.pageInfo.endCursor
          : "",
    };
  } catch {
    return undefined;
  }
}

function graphqlArgs(query: string, target: PullRequestTarget): string[] {
  return [
    "api",
    "graphql",
    "--hostname",
    target.host,
    "-f",
    `query=${query}`,
    "-F",
    `owner=${target.owner}`,
    "-F",
    `name=${target.name}`,
    "-F",
    `number=${target.number}`,
  ];
}

export interface FetchOutcome<T> {
  value?: T;
  authFailed: boolean;
}

export async function fetchThreadCount(
  pi: ExtensionAPI,
  cwd: string,
  target: PullRequestTarget,
): Promise<FetchOutcome<ThreadCountSnapshot>> {
  let unresolvedThreadCount = 0;
  let cursor = "";
  let lifecycle: PullRequestLifecycle | undefined;

  for (let page = 0; page < MAX_REVIEW_THREAD_PAGES; page++) {
    const args = graphqlArgs(THREAD_COUNT_QUERY, target);
    if (cursor) args.push("-F", `after=${cursor}`);

    const result = await gh(pi, args, cwd);
    if (result.code !== 0 || !result.stdout) {
      return { authFailed: isAuthFailure(result) };
    }

    const parsed = parseThreadCountPage(result.stdout);
    if (!parsed) return { authFailed: false };

    lifecycle = parsed.lifecycle ?? lifecycle;
    unresolvedThreadCount += parsed.unresolvedCount;
    if (!parsed.hasNextPage || !parsed.endCursor) break;
    cursor = parsed.endCursor;
  }

  return { value: { lifecycle, unresolvedThreadCount }, authFailed: false };
}

export async function fetchFeedback(
  pi: ExtensionAPI,
  cwd: string,
  target: PullRequestTarget,
): Promise<FetchOutcome<FeedbackSnapshot>> {
  const result = await gh(pi, graphqlArgs(FEEDBACK_QUERY, target), cwd);
  if (result.code !== 0 || !result.stdout.trim()) {
    return { authFailed: isAuthFailure(result) };
  }

  try {
    return {
      value: parseFeedbackSnapshot(JSON.parse(result.stdout) as GraphQlResponse),
      authFailed: false,
    };
  } catch {
    return { authFailed: false };
  }
}
