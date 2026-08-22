import assert from "node:assert/strict";
import test from "node:test";
import { selectCiStatus } from "./ci.ts";

function checks(statusChecks: unknown[]) {
  return JSON.stringify(statusChecks);
}

test("selectCiStatus keeps a failed PR check when a later check passes", () => {
  assert.deepEqual(
    selectCiStatus(
      checks([
        {
          bucket: "fail",
          link: "https://github.com/org/repo/actions/runs/1/job/1",
          startedAt: "2026-01-01T09:00:00Z",
          completedAt: "2026-01-01T09:30:00Z",
        },
        {
          bucket: "pass",
          link: "https://github.com/org/repo/actions/runs/2/job/2",
          startedAt: "2026-01-01T10:00:00Z",
          completedAt: "2026-01-01T10:30:00Z",
        },
      ]),
    ),
    {
      state: "failed",
      url: "https://github.com/org/repo/actions/runs/1/job/1",
    },
  );
});

test("selectCiStatus reports running when no PR check failed", () => {
  assert.deepEqual(
    selectCiStatus(
      checks([
        {
          bucket: "pass",
          link: "https://github.com/org/repo/actions/runs/3/job/3",
          startedAt: "2026-01-01T09:00:00Z",
          completedAt: "2026-01-01T09:30:00Z",
        },
        {
          bucket: "pending",
          link: "https://github.com/org/repo/actions/runs/4/job/4",
          startedAt: "2026-01-01T10:00:00Z",
          completedAt: "",
        },
      ]),
    ),
    {
      state: "running",
      url: "https://github.com/org/repo/actions/runs/4/job/4",
    },
  );
});

test("selectCiStatus reports okay for passing and skipped checks", () => {
  assert.deepEqual(
    selectCiStatus(
      checks([
        {
          bucket: "skipping",
          link: "https://github.com/org/repo/actions/runs/5/job/5",
          startedAt: "2026-01-01T09:00:00Z",
          completedAt: "2026-01-01T09:01:00Z",
        },
        {
          bucket: "pass",
          link: "https://ci.example.com/check/6",
          startedAt: "2026-01-01T10:00:00Z",
          completedAt: "2026-01-01T10:30:00Z",
        },
      ]),
    ),
    { state: "okay", url: "https://ci.example.com/check/6" },
  );
});

test("selectCiStatus treats cancelled checks as failed", () => {
  assert.deepEqual(
    selectCiStatus(
      checks([
        {
          bucket: "cancel",
          link: "",
          startedAt: "2026-01-01T10:00:00Z",
          completedAt: "2026-01-01T10:01:00Z",
        },
      ]),
      "https://github.com/org/repo/pull/42",
    ),
    { state: "failed", url: "https://github.com/org/repo/pull/42" },
  );
});

test("selectCiStatus hides malformed or empty check output", () => {
  assert.equal(selectCiStatus("not json"), undefined);
  assert.equal(selectCiStatus("{}"), undefined);
  assert.equal(selectCiStatus(checks([])), undefined);
  assert.equal(selectCiStatus(checks([null])), undefined);
  assert.equal(
    selectCiStatus(checks([{ bucket: "unknown", link: "" }])),
    undefined,
  );
});
