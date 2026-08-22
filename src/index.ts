import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  PI_PR_FEEDBACK_CHANNEL,
  PI_PR_PROTOCOL,
  PI_PR_STATE_CHANNEL,
  type FeedbackEvent,
  isFeedbackEvent,
} from "./api.ts";
import { createFooterPublisher } from "./footer.ts";
import { formatModelMessage } from "./format.ts";
import { loadHtmlConverter } from "./markdown.ts";
import { FEEDBACK_MESSAGE_TYPE, registerFeedbackRenderer } from "./message.ts";
import { createPoller } from "./poller.ts";

const USAGE = "Usage: /pr watch | /pr unwatch";

export default async function (pi: ExtensionAPI) {
  await loadHtmlConverter();

  let sessionActive = false;

  const footer = createFooterPublisher(pi);

  const poller = createPoller({
    pi,
    onState: (state) => {
      pi.events.emit(PI_PR_STATE_CHANNEL, state);
      footer.publish(state);
    },
    onFeedback: (target, feedback) => {
      pi.events.emit(PI_PR_FEEDBACK_CHANNEL, {
        protocol: PI_PR_PROTOCOL,
        source: "pi-pr",
        target,
        feedback,
      } satisfies FeedbackEvent);
    },
  });

  registerFeedbackRenderer(pi);

  // Any extension may publish review feedback on this channel; pi-pr turns it
  // into a steering message for the agent.
  const stopFeedbackListener = pi.events.on(PI_PR_FEEDBACK_CHANNEL, (raw) => {
    if (!sessionActive || !isFeedbackEvent(raw) || raw.feedback.length === 0) {
      return;
    }
    pi.sendMessage(
      {
        customType: FEEDBACK_MESSAGE_TYPE,
        content: formatModelMessage(raw.target, raw.feedback),
        display: true,
        details: raw,
      },
      { deliverAs: "steer", triggerTurn: true },
    );
  });

  pi.registerCommand("pr", {
    description: "Watch the current pull request for review feedback",
    getArgumentCompletions: (prefix) => {
      const options = [
        {
          value: "watch",
          label: "watch",
          description: "Load open feedback and watch",
        },
        { value: "unwatch", label: "unwatch", description: "Stop watching" },
      ];
      const matches = options.filter((option) =>
        option.value.startsWith(prefix),
      );
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      const words = args.trim().split(/\s+/).filter(Boolean);
      const action = words[0];

      if (action === "unwatch" && words.length === 1) {
        const stopped = poller.unwatch();
        ctx.ui.notify(
          stopped
            ? "Stopped watching the pull request"
            : "No pull request is being watched",
          "info",
        );
        return;
      }

      if (action !== "watch" || words.length !== 1) {
        ctx.ui.notify(USAGE, action ? "warning" : "info");
        return;
      }

      const result = await poller.watch(ctx.cwd);
      if (!result.ok) {
        ctx.ui.notify(`Cannot watch pull request: ${result.error}`, "error");
        return;
      }
      const target = result.target!;
      ctx.ui.notify(
        `Watching ${target.owner}/${target.name}#${target.number}`,
        "info",
      );
    },
  });

  pi.on("session_start", (_event, ctx) => {
    sessionActive = true;
    poller.start(ctx.cwd);
  });

  pi.on("session_shutdown", () => {
    sessionActive = false;
    poller.stop();
    footer.clear();
    footer.dispose();
    stopFeedbackListener();
  });
}
