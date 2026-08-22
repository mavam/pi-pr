---
title: GitHub pull request state and review watching
type: feature
authors:
  - mavam
created: 2026-08-22T06:06:26.90759Z
---

Pi PR owns every GitHub interaction in a Pi session. A single poll loop
resolves the pull request for the current branch, follows fork and upstream
remotes, and tracks its draft, auto-merge, CI, and review-thread state. The
loop refreshes every 60 seconds, drops to 30 seconds while watching, backs off
when GitHub is unreachable, and re-resolves the pull request as soon as you
switch branches.

Run `/pr watch` to load unresolved feedback into the session and stream new
conversation comments, reviews, and inline findings as they arrive. Feedback
cards preserve the author, reviewed commit, file location, priority, links, and
nearby diff context so Pi can address the review without losing its source
details. Use `/pr unwatch` to stop; watching also stops when the pull request
closes or merges.

When pi-fancy-footer is installed, Pi PR publishes three widgets: the pull
request number, unresolved review threads, and CI status.

```text
 7  󰅺3  
```

Watching swaps the review-thread icon for an accent-colored eye. Widgets dim
when GitHub state is degraded, and invalid destinations are left unlinked.

Other extensions can consume the same data without shelling out to `gh`:
`pi-pr/api` exposes the `pi-pr:state` and `pi-pr:feedback` event contracts.
