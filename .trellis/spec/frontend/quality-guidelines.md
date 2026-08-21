# Quality Guidelines

## Required Checks

Run from `web/`:

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm build
pnpm test:e2e
```

Interactive changes should also receive a runtime smoke check against the built app. The first Dashboard slice verifies `/`, `/manifest.webmanifest`, and `/sw.js` return successful responses.
For browser-only behavior, verify the built app at desktop and a 390px viewport: authentication, day/week switching, at least one menu/form action, AI clarification feedback, and horizontal overflow.
For transient interaction changes, also verify outside click, Escape, focus entry and return, `aria-expanded`, mutual exclusion, Sheet scroll lock, sidebar persistence after reload, and mobile navigation parity.
For Dashboard content changes, run a dense-state browser case rather than only an empty state: include next, completed, blocked, unplanned, and recent-change data; confirm the 390px calendar begins by 450px and no duplicated risk/history/detail blocks remain in default page flow.
When a control changes durable data, browser smoke should also inspect the returned state: settings must show the saved rule, notification failures must be visible, project filters must retain real project IDs, and recurrence detail must expose its single-occurrence boundary.
Playwright uses `data/goalset-e2e.db` and port `3100`; the server script recreates that exact test database before migration. Tests must never default to the personal `data/goalset.db` or port `3000`.
The Playwright web server command must `exec` Next after preparation so Playwright termination reaches the real server process. After every run, assert port `3100` has no listener; a wrapper that leaves `next-server` orphaned is a failing test harness.

## Required Patterns

- Reuse project-owned UI primitives for common controls.
- Use Lucide icons for production controls and provide accessible labels for icon-only buttons.
- Preserve truthful loading, empty, failure, and “not connected yet” states.
- Keep domain-specific layout code separate from persistence and provider code.

## Forbidden Patterns

- Do not silently replace failed data with zero progress or an empty schedule.
- Do not suppress TypeScript or ESLint errors to make a build green.
- Do not add a generic calendar library or template merely to avoid modeling the fixed/flexible/floating schedule contract.
- Do not make demo state look persisted or AI-connected when the service is not implemented.

## Review Checklist

- Does the change reuse an existing primitive or justify a new one?
- Are keyboard, focus, label, contrast, and mobile touch states covered?
- Is data flow typed at every boundary?
- Does an AI or schedule mutation have a single domain owner and an audit path?
