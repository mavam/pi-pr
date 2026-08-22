import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PullRequestStateEvent } from "./api.ts";
import { hyperlink } from "./format.ts";

/**
 * pi-fancy-footer's widget protocol, mirrored here so that pi-pr stays
 * dependency-free. Keep in sync with `pi-fancy-footer/src/api.ts`.
 */
const FANCY_FOOTER_PROTOCOL = 1;
const WIDGET_CHANNEL = "pi-fancy-footer:widget";
const READY_CHANNEL = "pi-fancy-footer:ready";

const NUMBER_WIDGET_ID = "pi-pr.number";
const THREADS_WIDGET_ID = "pi-pr.review-threads";
const CI_WIDGET_ID = "pi-pr.ci";

export const FOOTER_WIDGET_IDS = [
  NUMBER_WIDGET_ID,
  THREADS_WIDGET_ID,
  CI_WIDGET_ID,
];

type Glyphs = Record<"nerd" | "emoji" | "unicode" | "ascii", string>;

const GLYPHS = {
  pullRequest: {
    nerd: "\u{f408}",
    emoji: "\u{1f500}",
    unicode: "\u{21c4}",
    ascii: "@",
  },
  reviewThreads: {
    nerd: "\u{f017a}",
    emoji: "\u{1f4ac}",
    unicode: "\u{270e}",
    ascii: "!",
  },
  watching: {
    nerd: "\u{f06e}",
    emoji: "\u{1f441}\u{fe0f}",
    unicode: "\u{25c9}",
    ascii: "o",
  },
  ciRunning: {
    nerd: "\u{f252}",
    emoji: "\u{23f3}",
    unicode: "\u{25f7}",
    ascii: "~",
  },
  ciFailed: {
    nerd: "\u{f057}",
    emoji: "\u{274c}",
    unicode: "\u{2715}",
    ascii: "x",
  },
  ciOkay: {
    nerd: "\u{f058}",
    emoji: "\u{2705}",
    unicode: "\u{2713}",
    ascii: "+",
  },
} satisfies Record<string, Glyphs>;

/** Placeholder text for icon-only widgets; the footer hides empty content. */
const ICON_ONLY = "\u200b";

interface WidgetSpec {
  id: string;
  label: string;
  description: string;
  text: string;
  glyphs: Glyphs;
  iconColor: "text" | "accent" | "muted" | "dim" | "success" | "warning" | "error";
  position: number;
}

export interface FooterPublisher {
  publish(state: PullRequestStateEvent | undefined): void;
  clear(): void;
  dispose(): void;
}

function widgetsFor(state: PullRequestStateEvent): WidgetSpec[] {
  const pullRequest = state.pullRequest;
  if (!pullRequest || pullRequest.lifecycle === "closed") return [];

  const url = pullRequest.target.url;
  const widgets: WidgetSpec[] = [
    {
      id: NUMBER_WIDGET_ID,
      label: "Pull request",
      description: "Shows the pull request for the current branch",
      text: hyperlink(url, `${pullRequest.target.number}`),
      glyphs: GLYPHS.pullRequest,
      iconColor: pullRequest.isDraft
        ? "dim"
        : pullRequest.lifecycle === "merged"
          ? "muted"
          : pullRequest.autoMergeEnabled
            ? "accent"
            : "text",
      position: 3,
    },
  ];

  if (pullRequest.unresolvedThreadCount > 0 || pullRequest.watching) {
    widgets.push({
      id: THREADS_WIDGET_ID,
      label: "PR review threads",
      description: "Shows unresolved review threads and active pull request watching",
      text:
        pullRequest.unresolvedThreadCount > 0
          ? hyperlink(url, `${pullRequest.unresolvedThreadCount}`)
          : ICON_ONLY,
      glyphs: pullRequest.watching ? GLYPHS.watching : GLYPHS.reviewThreads,
      iconColor: pullRequest.watching ? "accent" : "text",
      position: 4,
    });
  }

  if (pullRequest.ci) {
    widgets.push({
      id: CI_WIDGET_ID,
      label: "PR CI status",
      description: "Shows the CI status for the current pull request",
      text: ICON_ONLY,
      glyphs:
        pullRequest.ci.state === "failed"
          ? GLYPHS.ciFailed
          : pullRequest.ci.state === "running"
            ? GLYPHS.ciRunning
            : GLYPHS.ciOkay,
      iconColor:
        pullRequest.ci.state === "failed"
          ? "error"
          : pullRequest.ci.state === "running"
            ? "warning"
            : "success",
      position: 5,
    });
  }

  return widgets;
}

export function createFooterPublisher(pi: ExtensionAPI): FooterPublisher {
  let lastState: PullRequestStateEvent | undefined;
  const published = new Set<string>();

  const remove = (id: string): void => {
    pi.events.emit(WIDGET_CHANNEL, {
      protocol: FANCY_FOOTER_PROTOCOL,
      type: "remove",
      id,
    });
    published.delete(id);
  };

  const render = (): void => {
    const widgets = lastState ? widgetsFor(lastState) : [];
    const live = new Set(widgets.map((widget) => widget.id));

    for (const id of [...published]) {
      if (!live.has(id)) remove(id);
    }

    for (const widget of widgets) {
      pi.events.emit(WIDGET_CHANNEL, {
        protocol: FANCY_FOOTER_PROTOCOL,
        type: "upsert",
        widget: {
          id: widget.id,
          label: widget.label,
          description: widget.description,
          content: { type: "text", text: widget.text },
          icon: { glyphs: widget.glyphs, color: widget.iconColor },
          layout: { row: 1, position: widget.position, align: "left" },
        },
      });
      published.add(widget.id);
    }
  };

  // Republish after the footer restarts and forgets external widgets.
  const stopReadyListener = pi.events.on(READY_CHANNEL, (raw) => {
    if (
      typeof raw === "object" &&
      raw !== null &&
      (raw as { protocol?: unknown }).protocol === FANCY_FOOTER_PROTOCOL
    ) {
      render();
    }
  });

  return {
    publish: (state) => {
      lastState = state;
      render();
    },
    clear: () => {
      lastState = undefined;
      for (const id of [...published]) remove(id);
    },
    dispose: () => {
      stopReadyListener();
    },
  };
}
