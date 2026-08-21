# Logging Guidelines

- Worker lifecycle logs use a `[goalset-worker]` or `[goalset-pwa-worker]` prefix.
- Log readiness, reconnects, bounded failure reasons, reminder status, and migration/startup failures.
- Never log `AUTH_SECRET`, passwords, API keys, QQ AppSecret, push private keys, or full user task/AI payloads.
- Provider errors returned to users are generic; internal logs may include a sanitized error code and request correlation ID.
