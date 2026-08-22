import assert from "node:assert/strict";
import test from "node:test";
import { isAuthFailure } from "./exec.ts";

test("isAuthFailure does not treat a missing gh command as bad credentials", () => {
  assert.equal(
    isAuthFailure({ code: -1, stdout: "", stderr: "spawn gh ENOENT" }),
    false,
  );
  assert.equal(
    isAuthFailure({ code: 1, stdout: "", stderr: "run gh auth login" }),
    true,
  );
});
