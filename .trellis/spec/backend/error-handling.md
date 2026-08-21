# Error Handling

## API Error Envelope

API failures use:

```json
{ "error": { "code": "INVALID_REQUEST", "message": "..." } }
```

Use `400` for invalid input, `401` for missing/invalid session, `404` for missing entities, `409` for confirmation/conflict, `422` for no safe schedule, and `5xx` for infrastructure/provider failures.

## Boundary Rules

- Decode request JSON with Zod before calling domain or database services.
- Do not expose provider credentials, database URLs, raw SQL, or full upstream error payloads.
- Preserve the original schedule when AI, QQ, PWA, or reminder delivery fails.
- Return a truthful unavailable/configuration state instead of an empty schedule.
- Log the internal cause server-side without logging secrets or full private task context.

## Integration Errors

- AI configuration failure: `503 AI_NOT_CONFIGURED`.
- AI upstream failure: `502 AI_REQUEST_FAILED`.
- QQ/PWA worker missing credentials: fail the worker with a configuration message; keep Web available.
- ChangeSet undo conflict/not-found: `404` or `409`, never overwrite newer changes silently.
