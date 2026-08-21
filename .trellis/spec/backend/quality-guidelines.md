# Quality Guidelines

## Required Checks

```bash
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
pnpm db:check
```

For deployment, also run SQLite `quick_check`/`foreign_key_check`, the Compose app/worker health checks, and authenticated API smoke tests.

## Required Patterns

- Keep scheduling decisions in the pure domain module, not in routes, React components, AI prompts, or QQ handlers.
- Keep channel adapters thin and route all commands through the same store/service boundary.
- Use transactions for task/block/change/reminder mutations.
- Use structured input/output schemas at every external boundary.
- Treat worker processes as optional integrations; Web remains usable when they are absent.

## Forbidden Patterns

- Do not let GET routes create demo data.
- Do not let an AI model write database rows directly.
- Do not bypass authentication on task/project/schedule APIs.
- Do not fall back from a database error to an empty schedule.
- Do not use personal-account QQ automation in place of the official Bot adapter.
