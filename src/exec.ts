import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const GIT_TIMEOUT_MS = 2_000;
export const GITHUB_TIMEOUT_MS = 10_000;

const GIT_NO_OPTIONAL_LOCKS_ARG = "--no-optional-locks";

export async function exec(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  cwd: string,
  timeout: number,
): Promise<ExecResult> {
  try {
    const result = await pi.exec(command, args, { cwd, timeout });
    return {
      code: result.code,
      stdout: result.stdout.replace(/[\r\n]+$/, ""),
      stderr: result.stderr.replace(/[\r\n]+$/, ""),
    };
  } catch (error) {
    return {
      code: -1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function git(
  pi: ExtensionAPI,
  args: string[],
  cwd: string,
): Promise<string> {
  const result = await exec(
    pi,
    "git",
    [GIT_NO_OPTIONAL_LOCKS_ARG, ...args],
    cwd,
    GIT_TIMEOUT_MS,
  );
  return result.code === 0 ? result.stdout : "";
}

export async function gh(
  pi: ExtensionAPI,
  args: string[],
  cwd: string,
): Promise<ExecResult> {
  return exec(pi, "gh", args, cwd, GITHUB_TIMEOUT_MS);
}

/** Distinguish failed GitHub authentication from other command failures. */
export function isAuthFailure(result: ExecResult): boolean {
  if (result.code === 0) return false;
  return /gh auth login|not logged into|authentication|bad credentials/i.test(
    result.stderr,
  );
}
