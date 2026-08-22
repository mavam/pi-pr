# 👁️ pi-pr

A [Pi](https://pi.dev) extension that owns GitHub pull request state for your
session: footer widgets, review feedback, and watching.

## 🚀 Installation

```sh
pi install npm:pi-pr
```

Install [GitHub CLI](https://cli.github.com/) and authenticate it before using
the extension.

## ✨ Usage

pi-pr resolves the pull request for the current branch on its own and keeps it
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
pi-pr publishes the pull request number, unresolved review threads, and CI
status:

```text
 7  󰅺3  
```

The pull request icon dims for drafts and turns accent-colored when auto-merge
is enabled. While `/pr watch` is active, an eye replaces the review-thread
icon:

```text
 7  3  
```

The widget IDs are `pi-pr.number`, `pi-pr.review-threads`, and `pi-pr.ci`. They
use pi-fancy-footer's event protocol without taking a package dependency on the
footer. You can change their placement, visibility, and colors with
`/fancy-footer`.

## 🔌 Extension API

pi-pr is the only extension that should poll GitHub in a session. Other
extensions consume its state from the event bus instead of shelling out to
`gh`:

```ts
import { createPiPrClient } from "pi-pr/api";

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

Publishing a `pi-pr:feedback` event yourself sends those findings to pi as a
steering message.

## 🧰 Requirements

- [GitHub CLI](https://cli.github.com/), authenticated with `gh auth login`

## 📄 License

[MIT](LICENSE)
