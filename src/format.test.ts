import assert from "node:assert/strict";
import test from "node:test";
import type { PullRequestTarget, ReviewFeedback } from "./api.ts";
import { formatDiffContext, formatModelMessage } from "./format.ts";

const target: PullRequestTarget = {
  host: "github.com",
  owner: "acme",
  name: "repo",
  number: 7,
  url: "https://github.com/acme/repo/pull/7",
};

function feedback(overrides: Partial<ReviewFeedback> = {}): ReviewFeedback {
  return {
    id: "one",
    kind: "inline",
    author: "reviewer",
    body: "Please fix this.",
    url: "https://github.com/acme/repo/pull/7#discussion_r1",
    createdAt: "2026-08-22T00:00:00Z",
    ...overrides,
  };
}

test("formatDiffContext anchors on the commented line", () => {
  const context = formatDiffContext(
    feedback({
      diffLine: 12,
      diffHunk: [
        "@@ -10,4 +10,5 @@ function example() {",
        " const a = 1;",
        " const b = 2;",
        "+const c = 3;",
        " return a + b;",
      ].join("\n"),
    }),
  );

  assert.match(context, /^\n\nDiff context:\n/);
  assert.match(context, /@@ -10,4 \+10,5 @@/);
  assert.match(context, /\+const c = 3;/);
});

test("formatDiffContext returns nothing without an anchor", () => {
  assert.equal(formatDiffContext(feedback()), "");
  assert.equal(
    formatDiffContext(feedback({ diffLine: 99, diffHunk: "@@ -1 +1 @@\n a" })),
    "",
  );
});

test("formatModelMessage hoists a shared author and commit into the header", () => {
  const message = formatModelMessage(target, [
    feedback({ reviewedCommit: "0123456789abcdef", path: "src/index.ts", line: 4 }),
    feedback({ id: "two", reviewedCommit: "0123456789abcdef", title: "Fix it" }),
  ]);

  assert.match(message, /^acme\/repo#7 · commit 0123456789 · 2 findings · @reviewer/);
  assert.match(message, /src\/index\.ts:4/);
  assert.doesNotMatch(message, /@reviewer · /);
});

test("formatModelMessage keeps per-finding attribution when authors differ", () => {
  const message = formatModelMessage(target, [
    feedback({ author: "one" }),
    feedback({ id: "two", author: "two", priority: "P1", title: "Leak" }),
  ]);

  assert.match(message, /@one/);
  assert.match(message, /@two · \[P1\] — Leak/);
});
