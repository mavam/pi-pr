import type { PullRequestTarget, ReviewFeedback } from "./api.ts";

export function hyperlink(url: string, text: string): string {
  if (!/^https?:\/\/[^\s\u001b\u0007]+$/.test(url)) return text;
  return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}

export function formatLocation(feedback: ReviewFeedback): string {
  if (!feedback.path) return "";
  return feedback.line === undefined
    ? feedback.path
    : `${feedback.path}:${feedback.line}`;
}

export function shortCommit(commit: string): string {
  return commit.slice(0, 10);
}

export function sharedValue(
  values: Array<string | undefined>,
): string | undefined {
  if (values.length === 0 || values.some((value) => !value)) return undefined;
  const first = values[0];
  return values.every((value) => value === first) ? first : undefined;
}

export function formatFindingCount(count: number): string {
  return count === 1 ? "1 finding" : `${count} findings`;
}

/** Extract the diff lines around an inline comment's anchor. */
export function formatDiffContext(feedback: ReviewFeedback): string {
  if (!feedback.diffHunk || feedback.diffLine === undefined) return "";

  const lines = feedback.diffHunk.split("\n");
  let newLine = 0;
  let hunkHeader = -1;
  let target = -1;
  for (const [index, line] of lines.entries()) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      newLine = Number.parseInt(header[1]!, 10);
      hunkHeader = index;
      continue;
    }
    if (hunkHeader < 0 || line.startsWith("\\")) continue;

    const hasNewLine = line[0] !== "-";
    if (hasNewLine && newLine === feedback.diffLine) {
      target = index;
      break;
    }
    if (hasNewLine) newLine += 1;
  }
  if (target < 0) return "";

  const start = Math.max(hunkHeader + 1, target - 4);
  const end = Math.min(lines.length, target + 5);
  return `\n\nDiff context:\n${[lines[hunkHeader], ...lines.slice(start, end)].join("\n")}`;
}

export function formatModelMessage(
  target: PullRequestTarget,
  feedback: ReviewFeedback[],
): string {
  const author = sharedValue(feedback.map((item) => item.author));
  const commit = sharedValue(feedback.map((item) => item.reviewedCommit));
  const header = [
    `${target.owner}/${target.name}#${target.number}`,
    commit ? `commit ${shortCommit(commit)}` : "",
    formatFindingCount(feedback.length),
    author ? `@${author}` : "",
  ].filter(Boolean);

  const findings = feedback.map((item) => {
    const finding = [item.priority ? `[${item.priority}]` : "", formatLocation(item)]
      .filter(Boolean)
      .join(" ");
    const metadata = [
      author ? "" : `@${item.author}`,
      commit || !item.reviewedCommit
        ? ""
        : `commit ${shortCommit(item.reviewedCommit)}`,
      finding,
    ]
      .filter(Boolean)
      .join(" · ");
    const title = item.title
      ? [metadata, item.title].filter(Boolean).join(" — ")
      : metadata;
    const heading = [title, item.url].filter(Boolean).join(" ");
    const review = [heading, item.body].filter(Boolean).join("\n\n");
    return `${review}${formatDiffContext(item)}`;
  });

  return `${header.join(" · ")} ${target.url}\n\n${findings.join("\n\n---\n\n")}`;
}
