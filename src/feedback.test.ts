import assert from "node:assert/strict";
import test from "node:test";
import { parseFeedbackSnapshot, parseThreadCountPage } from "./feedback.ts";

test("parseFeedbackSnapshot counts unresolved review threads once", () => {
  const response = {
    data: {
      viewer: { login: "mavam" },
      repository: {
        pullRequest: {
          state: "OPEN",
          comments: { nodes: [] },
          reviews: { nodes: [] },
          reviewThreads: {
            nodes: [
              {
                isResolved: false,
                comments: {
                  nodes: [
                    {
                      id: "first",
                      body: "First comment",
                      createdAt: "2026-08-22T00:00:00Z",
                      url: "https://github.com/acme/repo/pull/1#discussion_r1",
                      author: { login: "reviewer" },
                    },
                    {
                      id: "reply",
                      body: "A reply in the same thread",
                      createdAt: "2026-08-22T00:01:00Z",
                      url: "https://github.com/acme/repo/pull/1#discussion_r2",
                      author: { login: "mavam" },
                    },
                  ],
                },
              },
              {
                isResolved: false,
                comments: { nodes: [] },
              },
              {
                isResolved: true,
                comments: { nodes: [] },
              },
            ],
          },
        },
      },
    },
  };

  const snapshot = parseFeedbackSnapshot(response as never);
  assert.equal(snapshot?.unresolvedThreadCount, 2);
  assert.equal(snapshot?.openFeedback.length, 2);
});

test("parseFeedbackSnapshot reports the pull request lifecycle", () => {
  const snapshot = parseFeedbackSnapshot({
    data: {
      repository: {
        pullRequest: { state: "MERGED", comments: { nodes: [] } },
      },
    },
  } as never);

  assert.equal(snapshot?.lifecycle, "merged");
});

test("parseThreadCountPage counts unresolved threads and paginates", () => {
  assert.deepEqual(
    parseThreadCountPage(
      JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              state: "OPEN",
              reviewThreads: {
                pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
                nodes: [
                  { isResolved: false },
                  { isResolved: true },
                  { isResolved: false },
                ],
              },
            },
          },
        },
      }),
    ),
    {
      lifecycle: "open",
      unresolvedCount: 2,
      hasNextPage: true,
      endCursor: "cursor-1",
    },
  );
});
