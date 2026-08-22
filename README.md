# 🐙 pi-prs

A [Pi](https://pi.dev) extension that owns GitHub pull request state for your
session: footer widgets, review feedback, and watching.

## 🚀 Installation

```sh
pi install npm:pi-prs
```

Install [GitHub CLI](https://cli.github.com/) and authenticate it before using
the extension.

## ✨ Usage

pi-prs resolves the pull request for the current branch on its own and keeps it
fresh in the background. Fork and upstream remotes both work, and switching
branches re-resolves immediately.

Start watching that pull request for review feedback:

```text
/pr watch
```

The extension sends unresolved review feedback to pi, then checks GitHub every
30 seconds for new comments and reviews. New external feedback starts an agent
turn so pi can address it.

Stop watching:

```text
/pr unwatch
```

Watching stops automatically when the pull request closes or merges.

## 🧩 Footer widgets

When [pi-fancy-footer](https://github.com/mavam/pi-fancy-footer) is installed,
pi-prs publishes the pull request number, unresolved review threads, and CI
status. You can change their placement, visibility, and colors with
`/fancy-footer`.

## 🔌 Extension API

pi-prs is the only extension that should poll GitHub in a session. Other
extensions consume its state from the event bus instead of shelling out to
`gh`:

```ts
import { createPiPrClient } from "pi-prs/api";

export default function (pi) {
  const client = createPiPrClient(pi);
  client.onState((state) => {
    // state.pullRequest?.ci, .unresolvedThreadCount, .isDraft, …
  });
  client.onFeedback((event) => {
    // event.feedback: new review findings
  });
}
```

Publishing a `pi-prs:feedback` event yourself sends those findings to pi as a
steering message.

## 🧰 Requirements

- [GitHub CLI](https://cli.github.com/), authenticated with `gh auth login`

## 📄 License

[MIT](LICENSE)
