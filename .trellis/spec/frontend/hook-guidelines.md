# Hook Guidelines

## Browser and External State

- Use `useSyncExternalStore` for browser subscriptions such as media queries so the server snapshot and client snapshot remain consistent.
- Do not call `setState` synchronously inside a mount effect just to derive browser state; this triggers cascading-render lint failures and can create hydration flicker.
- Keep browser-only APIs behind client components. Server components must not read `window`, `navigator`, or service-worker state.

## Local UI State

- Keep transient view state local to the feature component unless two routes or unrelated features must share it.
- Use controlled state for AI input, view overrides, filters, and confirmation state.
- Keep domain mutations in services/actions once persistence exists; a hook should not silently become a second scheduling engine.

## Data Fetching

No server-state library is established yet. When persistence is added, choose one boundary for fetching/caching and keep response decoding there; do not make each component parse database-shaped payloads independently.
