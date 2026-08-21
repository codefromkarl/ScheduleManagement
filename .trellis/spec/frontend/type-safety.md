# Type Safety

## Type Organization

- Domain types live in the owning feature module and are imported by UI consumers.
- Use discriminated unions for schedule kinds, task status, priorities, and future AI command intents.
- Keep display labels in typed `Record<Union, string>` maps so adding a domain value forces the display map to be updated.

## Runtime Validation

TypeScript types do not validate AI, channel, or HTTP input at runtime. When those boundaries are added, decode `unknown` once at the boundary with a schema validator and pass the normalized type inward.

## Forbidden Patterns

- Do not use `any` for task, schedule, or AI payloads.
- Do not cast an untyped provider payload separately in multiple components.
- Do not use formatted date strings as the source of truth for scheduling calculations.
