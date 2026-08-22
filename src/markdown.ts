/** Turndown-backed conversion of GitHub's rendered HTML into Markdown. */

const CODEX_REVIEW_AUTHOR = "chatgpt-codex-connector";

export interface ReviewContent {
  body: string;
  priority?: string;
  title?: string;
}

let markdownFromHtml: ((html: string) => string) | undefined;

export async function loadHtmlConverter(): Promise<void> {
  try {
    const [{ default: TurndownService }, { gfm }] = await Promise.all([
      import("turndown"),
      import("turndown-plugin-gfm"),
    ]);
    const turndown = new TurndownService({
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
    });
    turndown.use(gfm);
    turndown.addRule("github-priority-badge", {
      filter: (node) => {
        const image = node.nodeName === "A" ? node.firstElementChild : undefined;
        return (
          image?.nodeName === "IMG" &&
          /^P\d+ Badge$/i.test(image.getAttribute?.("alt") ?? "")
        );
      },
      replacement: (_content, node) =>
        node.firstElementChild?.getAttribute("alt") ?? "",
    });
    markdownFromHtml = (html) => turndown.turndown(html);
  } catch {
    // GitHub's source Markdown remains usable without optional npm packages.
  }
}

export function normalizeReviewMarkdown(markdown: string): ReviewContent {
  const withoutFooter = markdown
    .replace(/(?:^|\n{2,})Useful\?\s+React with\s+👍\s*\/\s*👎\.?\s*$/u, "")
    .trim();
  const heading = /^\*\*(P\d+) Badge\s+([^\n]+)\*\*(?:\n{2,}|$)/u.exec(
    withoutFooter,
  );
  if (!heading) return { body: withoutFooter };

  return {
    body: withoutFooter.slice(heading[0].length).trim(),
    priority: heading[1]?.toUpperCase(),
    title: heading[2]?.trim(),
  };
}

/** Drop the boilerplate that wraps every Codex review body. */
export function stripCodexReviewBoilerplate(markdown: string): string {
  if (!/^###\s+💡\s+Codex Review(?:\n|$)/u.test(markdown)) return markdown;

  const withoutIntro = markdown
    .replace(/^###\s+💡\s+Codex Review\s*/u, "")
    .replace(
      /^Here are some automated review suggestions for this pull request\.\s*/u,
      "",
    )
    .replace(/^\*\*Reviewed commit:\*\*\s+`?[0-9a-f]{7,40}`?\s*/iu, "");
  const aboutIndex = withoutIntro.search(
    /(?:^|\n+)ℹ️\s+About Codex in GitHub[ \t]*(?:\n|$)/iu,
  );
  return (
    aboutIndex < 0 ? withoutIntro : withoutIntro.slice(0, aboutIndex)
  ).trim();
}

export function reviewContentFrom(
  body: string,
  bodyHtml: string,
  author: string,
  isReview: boolean,
): ReviewContent {
  let content: ReviewContent | undefined;
  if (bodyHtml && markdownFromHtml) {
    try {
      content = normalizeReviewMarkdown(markdownFromHtml(bodyHtml).trim());
    } catch {
      // Fall back to GitHub's source Markdown when conversion fails.
    }
  }
  content ??= normalizeReviewMarkdown(body);

  if (!isReview || author !== CODEX_REVIEW_AUTHOR) return content;
  return { ...content, body: stripCodexReviewBoilerplate(content.body) };
}
