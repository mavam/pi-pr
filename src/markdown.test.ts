import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeReviewMarkdown,
  reviewContentFrom,
  stripCodexReviewBoilerplate,
} from "./markdown.ts";

test("normalizeReviewMarkdown lifts the priority badge into title and priority", () => {
  assert.deepEqual(
    normalizeReviewMarkdown(
      "**P1 Badge Race in the poll loop**\n\nThe timer keeps running.",
    ),
    {
      body: "The timer keeps running.",
      priority: "P1",
      title: "Race in the poll loop",
    },
  );
});

test("normalizeReviewMarkdown drops the reaction footer", () => {
  assert.deepEqual(
    normalizeReviewMarkdown("Looks good.\n\nUseful? React with 👍 / 👎."),
    { body: "Looks good." },
  );
});

test("stripCodexReviewBoilerplate keeps only the findings", () => {
  const body = [
    "### 💡 Codex Review",
    "",
    "Here are some automated review suggestions for this pull request.",
    "",
    "**Reviewed commit:** `abc1234`",
    "",
    "The poller never stops.",
    "",
    "ℹ️ About Codex in GitHub",
    "",
    "Codex reviews pull requests.",
  ].join("\n");

  assert.equal(stripCodexReviewBoilerplate(body), "The poller never stops.");
});

test("stripCodexReviewBoilerplate leaves other reviews untouched", () => {
  assert.equal(stripCodexReviewBoilerplate("Nice work."), "Nice work.");
});

test("reviewContentFrom only strips boilerplate for Codex reviews", () => {
  const body = "### 💡 Codex Review\n\nThe poller never stops.";

  assert.equal(
    reviewContentFrom(body, "", "chatgpt-codex-connector", true).body,
    "The poller never stops.",
  );
  assert.equal(reviewContentFrom(body, "", "someone", true).body, body);
  assert.equal(
    reviewContentFrom(body, "", "chatgpt-codex-connector", false).body,
    body,
  );
});
