import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PI_PR_PROTOCOL, type PullRequestStateEvent } from "./api.ts";
import { createFooterPublisher } from "./footer.ts";

interface WidgetMessage {
  type: "upsert" | "remove";
  id?: string;
  widget?: {
    id: string;
    content: { text: string };
    icon: { glyphs: Record<string, string>; color: string };
    layout: { row: number; position: number };
  };
}

function fakePi(): { pi: ExtensionAPI; messages: WidgetMessage[] } {
  const messages: WidgetMessage[] = [];
  const pi = {
    events: {
      emit: (_channel: string, payload: unknown) => {
        messages.push(payload as WidgetMessage);
      },
      on: () => () => {},
    },
  } as unknown as ExtensionAPI;
  return { pi, messages };
}

function state(
  pullRequest: PullRequestStateEvent["pullRequest"],
): PullRequestStateEvent {
  return {
    protocol: PI_PR_PROTOCOL,
    source: "pi-pr",
    repository: "acme/repo",
    branch: "feature",
    health: "ok",
    ...(pullRequest ? { pullRequest } : {}),
    updatedAt: 0,
  };
}

const openPullRequest = {
  target: {
    host: "github.com",
    owner: "acme",
    name: "repo",
    number: 7,
    url: "https://github.com/acme/repo/pull/7",
  },
  lifecycle: "open" as const,
  isDraft: false,
  autoMergeEnabled: false,
  headRefOid: "abc",
  unresolvedThreadCount: 0,
  watching: false,
};

test("publishes the number widget with a terminal hyperlink", () => {
  const { pi, messages } = fakePi();
  createFooterPublisher(pi).publish(state(openPullRequest));

  assert.equal(messages.length, 1);
  const widget = messages[0]?.widget;
  assert.equal(widget?.id, "pi-pr.number");
  assert.match(widget?.content.text ?? "", /\u001b\]8;;https:\/\/github\.com/);
  assert.match(widget?.content.text ?? "", /7/);
  assert.deepEqual(widget?.layout, { row: 1, position: 3, align: "left" });
});

test("colors draft, auto-merge, and merged pull requests", () => {
  const cases = [
    [{ ...openPullRequest, isDraft: true }, "dim"],
    [{ ...openPullRequest, autoMergeEnabled: true }, "accent"],
    [{ ...openPullRequest, lifecycle: "merged" as const }, "muted"],
    [openPullRequest, "text"],
  ] as const;

  for (const [pullRequest, color] of cases) {
    const { pi, messages } = fakePi();
    createFooterPublisher(pi).publish(state(pullRequest));
    assert.equal(messages[0]?.widget?.icon.color, color);
  }
});

test("swaps the review-thread glyph while watching", () => {
  const { pi, messages } = fakePi();
  const footer = createFooterPublisher(pi);

  footer.publish(state({ ...openPullRequest, unresolvedThreadCount: 3 }));
  const idle = messages.find((message) => message.widget?.id === "pi-pr.review-threads");
  assert.match(idle?.widget?.content.text ?? "", /3/);
  assert.equal(idle?.widget?.icon.color, "text");

  messages.length = 0;
  footer.publish(
    state({ ...openPullRequest, unresolvedThreadCount: 3, watching: true }),
  );
  const watching = messages.find(
    (message) => message.widget?.id === "pi-pr.review-threads",
  );
  assert.equal(watching?.widget?.icon.color, "accent");
  assert.notEqual(
    watching?.widget?.icon.glyphs.nerd,
    idle?.widget?.icon.glyphs.nerd,
  );
});

test("keeps the review-thread widget visible while watching without findings", () => {
  const { pi, messages } = fakePi();
  createFooterPublisher(pi).publish(state({ ...openPullRequest, watching: true }));

  assert.ok(
    messages.some((message) => message.widget?.id === "pi-pr.review-threads"),
  );
});

test("publishes the CI widget only when a status exists", () => {
  const { pi, messages } = fakePi();
  const footer = createFooterPublisher(pi);

  footer.publish(state(openPullRequest));
  assert.equal(
    messages.some((message) => message.widget?.id === "pi-pr.ci"),
    false,
  );

  messages.length = 0;
  footer.publish(
    state({
      ...openPullRequest,
      ci: { state: "failed", url: "https://github.com/acme/repo/actions/runs/1" },
    }),
  );
  const ci = messages.find((message) => message.widget?.id === "pi-pr.ci");
  assert.equal(ci?.widget?.icon.color, "error");
});

test("removes widgets that no longer apply", () => {
  const { pi, messages } = fakePi();
  const footer = createFooterPublisher(pi);

  footer.publish(state({ ...openPullRequest, unresolvedThreadCount: 2 }));
  messages.length = 0;

  footer.publish(state(undefined));
  assert.deepEqual(
    messages.filter((message) => message.type === "remove").map((m) => m.id),
    ["pi-pr.number", "pi-pr.review-threads"],
  );
});

test("hides widgets for a closed pull request", () => {
  const { pi, messages } = fakePi();
  createFooterPublisher(pi).publish(
    state({ ...openPullRequest, lifecycle: "closed" }),
  );

  assert.equal(messages.length, 0);
});
