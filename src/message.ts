import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { type FeedbackEvent, isFeedbackEvent } from "./api.ts";
import {
  formatFindingCount,
  formatLocation,
  hyperlink,
  sharedValue,
  shortCommit,
} from "./format.ts";

export const FEEDBACK_MESSAGE_TYPE = "pi-pr-review-feedback";

export function registerFeedbackRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer<FeedbackEvent>(
    FEEDBACK_MESSAGE_TYPE,
    (message, { outputPad }, theme) => {
      const details = message.details;
      if (!details || !isFeedbackEvent(details)) return undefined;

      const box = new Box(outputPad, 1, (text) =>
        theme.bg("customMessageBg", text),
      );
      const markdownTheme = {
        ...getMarkdownTheme(),
        quote: (text: string) => theme.fg("customMessageText", text),
        quoteBorder: (text: string) => theme.fg("dim", text),
      };

      const separator = theme.fg("dim", " · ");
      const author = sharedValue(details.feedback.map((item) => item.author));
      const commit = sharedValue(
        details.feedback.map((item) => item.reviewedCommit),
      );
      const label = `${details.target.owner}/${details.target.name}#${details.target.number}`;
      let header = theme.fg("muted", label);
      if (commit) {
        header += separator + theme.fg("dim", `commit ${shortCommit(commit)}`);
      }
      header +=
        separator + theme.fg("dim", formatFindingCount(details.feedback.length));
      if (author) header += separator + theme.fg("accent", `@${author}`);
      header += ` ${hyperlink(details.target.url, theme.fg("accent", "↗"))}`;
      box.addChild(new Text(header, 0, 0));

      for (const item of details.feedback) {
        box.addChild(new Spacer(1));

        const location = formatLocation(item);
        let itemHeader = author ? "" : theme.fg("accent", `@${item.author}`);
        if (!commit && item.reviewedCommit) {
          if (itemHeader) itemHeader += separator;
          itemHeader += theme.fg("dim", `commit ${shortCommit(item.reviewedCommit)}`);
        }
        if (location) {
          if (itemHeader) itemHeader += separator;
          itemHeader += theme.fg("text", location);
        }
        if (itemHeader) itemHeader += " ";
        itemHeader += hyperlink(item.url, theme.fg("accent", "↗"));
        box.addChild(new Text(itemHeader, 0, 0));

        if (item.title) {
          box.addChild(new Spacer(1));
          let title = "";
          if (item.priority) {
            const priority = `[${item.priority}]`;
            if (item.priority === "P0" || item.priority === "P1") {
              title = theme.fg("error", theme.bold(priority));
            } else if (item.priority === "P2") {
              title = theme.fg("warning", theme.bold(priority));
            } else {
              title = theme.fg("muted", theme.bold(priority));
            }
            title += " ";
          }
          title += theme.fg("customMessageText", theme.bold(item.title));
          box.addChild(new Text(title, 0, 0));
        }

        if (item.body) {
          box.addChild(new Spacer(1));
          box.addChild(
            new Markdown(item.body, 0, 0, markdownTheme, {
              color: (text) => theme.fg("customMessageText", text),
            }),
          );
        }
      }

      return box;
    },
  );
}
