# State Management

## State Categories

- Local UI state: view mode overrides, project filters, input text, and open/closed panels stay in the owning client component.
- URL state: use the URL for shareable date/view/filter state once navigation is introduced.
- Server state: persisted tasks, schedule blocks, change sets, reminders, and preferences must come from a typed server boundary; they must not be treated as permanent React local state.
- External browser state: media-query and service-worker subscriptions use browser subscription APIs, not ad-hoc effect-driven copies.

## Derived State

Compute visible schedule items and progress from typed source data. Do not duplicate task status in multiple component states. The deterministic scheduling service will remain the only owner of schedule mutations.

## Common Mistakes

- Do not use a page-level global store for a filter used by one feature.
- Do not let a visual calendar component move tasks without producing a domain change set.
- Do not turn a temporary demo array into an implied persistence contract.
