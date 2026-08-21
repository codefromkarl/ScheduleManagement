# Reminder Delivery and Thin IM Gateways

## 1. Scope / Trigger

This contract applies to PWA Web Push, QQ/AstrBot transport experiments, reminder receipts, device subscriptions, test notifications, and any external IM gateway. Goalset remains the sole task/schedule authority; gateways deliver already-decided messages or forward commands into the typed Goalset command boundary.

## 2. Signatures

```text
POST /api/pwa/subscription
POST /api/pwa/test
POST /api/pwa/receipt  { reminderId: UUID }
POST /api/qq/test      { delayMinutes?: integer 0..60 } -> 202 { reminderId, status: "pending", scheduledAt }
GET  /api/status       -> reminderChannels[], qqConfigured, pwaConfigured, pwaSubscriptionCount, workers[]
GET  /api/reminders    -> sentAt, receivedAt, status, error
pnpm qq:pair           -> one-time C2C owner identification

reminders.kind         += "test"
reminders.received_at  INTEGER timestamp_ms nullable
```

```ts
deliverPwaPayload(targets, payload, send): Promise<{
  acceptedIds: string[];
  staleIds: string[];
  errors: string[];
}>

new AstrBotGateway({ baseUrl, apiKey, ownerUmo }).sendText(text)
// POST /api/v1/im/message
// { umo: ownerUmo, message: [{ type: "plain", text }] }
```

Environment:

```text
REMINDER_CHANNELS      # comma-separated qq/pwa; current rollout is qq
QQBOT_APP_ID
QQBOT_APP_SECRET
QQBOT_OWNER_USER_ID
QQBOT_PAIRING_CODE     # optional six-digit override for a supervised pairing run

NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT

ASTRBOT_BASE_URL       # HTTPS, or loopback HTTP for an isolated sidecar
ASTRBOT_API_KEY        # least-privilege IM API key
ASTRBOT_OWNER_UMO      # one allowlisted QQ/AstrBot destination
ASTRBOT_SMOKE_SEND     # explicit true only for one external smoke message
```

## 3. Contracts

- Channel selection and credential availability are separate. `REMINDER_CHANNELS=qq` means only QQ outbox rows may be created even if old VAPID credentials still exist; the PWA worker stays stopped. Missing `REMINDER_CHANNELS` keeps the backward-compatible `qq,pwa` selection.
- The current rollout deliberately uses QQ as the only reminder and sudden-task channel and does not deploy Tailscale. It has no verified fallback until proactive delivery passes short, beyond-reply-window, and restart tests; the UI must say so truthfully.
- `POST /api/qq/test` creates one deduplicated QQ outbox row only when QQ is selected and all official Bot credentials exist. `sentAt` means the QQ API accepted the send, not that the owner's client displayed it.
- `pnpm qq:pair` requires App ID/secret but no owner ID. It accepts only an exact C2C `绑定 Goalset <six digits>` command, prints the matching sender OpenID after acknowledgement, times out after ten minutes, and refuses to run when an owner already exists unless `QQBOT_PAIRING_ALLOW_REBIND=true` is explicitly set.
- The production QQ worker keeps SDK debug logging disabled because the SDK may log outbound/inbound message bodies. Provider errors pass through `sanitizedQqError()` before logs, worker health, or reminder error storage; no AppSecret may appear in any of them.
- Reserved QQ control commands are parsed before the scheduling command boundary. `已发送`, `已收到`, messages beginning with `都收到了` or `身份验证收到`, and `帮助`/`菜单`/`/help` produce a concise channel response and never create or modify tasks. Similar words inside a real task sentence are not intercepted.
- The QQ test endpoint defaults to immediate delivery and accepts an optional integer delay of at most 60 minutes. Delayed tests remain ordinary pending outbox rows so the same worker claim/retry/deduplication path proves proactive delivery beyond a passive reply window.
- `sentAt` means the push provider accepted at least one device request. It does not mean a device received or displayed the notification.
- The service worker posts `/api/pwa/receipt` from the push event; only then is `receivedAt` set and the UI may say “设备已收到”.
- A receipt is accepted only for a PWA reminder in `sending` or `sent` state. A failed/pending reminder cannot be forged into received state.
- Device sends are isolated. One expired subscription (`404`/`410`) is pruned without failing healthy devices; transient failures remain visible. The reminder succeeds when at least one active subscription accepts the payload.
- The PWA test endpoint requires configured VAPID credentials and at least one stored subscription. Test UI waits longer than the 30-second worker interval before reporting no receipt.
- `PushManager.subscribe()` rejection must be returned as truthful browser/Push-Service failure; notification permission alone is not subscription evidence.
- AstrBot is a thin optional sidecar. Use `/api/v1/im/message`, not AstrBot chat/Agent/future-task APIs. It must not persist a competing Goalset task model or bypass ChangeSet confirmation.
- AstrBot cleartext HTTP is allowed only on loopback. Remote gateways require HTTPS. Error messages expose HTTP status, never upstream bodies or API keys.
- Inbound AstrBot traffic requires exact owner UMO equality and an injected durable message claim before command execution. The POC contract is not a production inbound route until real credentials and passive reply are accepted.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| `REMINDER_CHANNELS=qq` with valid VAPID credentials | Do not create PWA outbox rows; reject PWA test with `409 PWA_NOT_ENABLED`. |
| QQ selected but credentials missing | `409 QQ_NOT_CONFIGURED`; settings state that no reminder will send. |
| QQ not selected | `409 QQ_NOT_ENABLED`; do not enqueue a fake test. |
| QQ worker marks a test `sent` | UI says QQ API accepted and asks for client confirmation; do not claim receipt. |
| Pairing receives wrong code, group message, or expired message | Ignore it; do not reveal or persist a sender ID. |
| Pairing starts with an existing owner | Refuse by default; rebind requires explicit operator opt-in. |
| QQ provider error contains AppSecret or is oversized | Replace the secret with `[redacted]` and truncate to 500 characters. |
| User sends a reserved receipt/help command | Claim/deduplicate the message, return the control reply, and stop before AI or schedule services. |
| Task text merely contains `已收到` | Continue normal task parsing unless the whole message matches a reserved receipt form. |
| QQ test delay is negative, fractional, or over 60 | `400 INVALID_REQUEST`; do not create an outbox row. |
| VAPID credentials missing | `409 PWA_NOT_CONFIGURED`; Dashboard remains usable. |
| No subscribed device | `409 PWA_NOT_SUBSCRIBED`; do not enqueue a fake test success. |
| Push provider accepts | Set `sentAt`; UI says provider accepted while waiting for receipt. |
| Service worker receives push | Set `receivedAt`; UI may report device receipt. |
| Subscription returns `404`/`410` | Delete that subscription and continue other devices. |
| All subscriptions fail | Mark reminder `failed` with bounded error text; never mutate tasks. |
| Browser grants notifications but PushManager rejects | Show a Push Service failure; do not claim PWA enabled. |
| Receipt targets pending/failed/non-PWA reminder | Return not found; do not set `receivedAt`. |
| AstrBot uses public HTTP | Reject configuration before network access. |
| AstrBot returns error body containing private data | Report only HTTP status. |
| Non-owner or duplicate inbound AstrBot message | Reject before the Goalset command handler runs. |

## 5. Good / Base / Bad Cases

- Good: QQ-only selection ignores leftover VAPID credentials, the PWA worker is stopped, and a QQ test remains visibly unverified until the owner confirms the client message.
- Good: a supervised one-time code binds the intended C2C sender, then the normal worker enforces exact owner equality for every command.
- Good: `都收到了，测试提醒2条` records a receipt response while `整理已收到的客户文件` remains a task command.
- Good: provider accepts, the service worker posts a receipt, notification history changes from “等待设备回执” to “设备已收到” after PWA is explicitly re-enabled.
- Good: one stale phone endpoint is pruned while another device receives the same reminder.
- Base: QQ-only is selected without credentials; scheduling remains usable while settings truthfully show that reminders cannot send.
- Base: automated Chrome lacks a Push Service and reports permission denied; the deferred human phone/HTTPS gate stays open.
- Base: AstrBot fake gateway proves UMO/auth payloads without installing AstrBot or sending externally.
- Bad: set `sentAt` and tell the user the notification was received.
- Bad: let AstrBot Agent create its own future tasks or edit Goalset SQLite directly.
- Bad: enable OneBot/personal-account automation to avoid the QQ official capability gate.
- Bad: infer selected channels from whichever secrets happen to remain in `.env.local`.
- Bad: start a first-message-wins pairing listener with no nonce, or leave SDK debug logs enabled after real credentials are installed.
- Bad: route delivery acknowledgements through the AI duration parser, or implement delayed acceptance with a second timer outside the reminder outbox.

## 6. Tests Required

- Unit-test mixed PWA delivery: accepted, stale, and transient failure in one batch.
- Unit-test channel parsing, QQ-only selection, unknown values, and selection-versus-credential separation.
- Unit-test six-digit pairing command normalization/rejection and provider-error secret redaction/length bounds.
- Unit-test reserved receipt/help commands against near-match task text, plus immediate/default and bounded delayed QQ test scheduling.
- API/browser acceptance for QQ test must distinguish pending, API accepted, failed, and human-confirmed client receipt; do not manufacture a receipt timestamp.
- SQLite-test `receivedAt` round-trip and migration integrity.
- Browser-test truthful outcomes for enabled, missing-key, and Push-Service-rejected subscription attempts.
- Isolated worker smoke must preserve exact transport failure and task/schedule state.
- Real phone acceptance requires HTTPS/secure context, OS notification observation, and a matching service-worker receipt.
- AstrBot unit tests must cover HTTPS/loopback policy, bearer header, exact UMO payload, owner rejection, duplicate claim, and response-body redaction.
- AstrBot runtime smoke is dry-run by default; external send requires explicit `ASTRBOT_SMOKE_SEND=true`.

## 7. Wrong vs Correct

### Wrong

```ts
await webpush.sendNotification(subscription, payload);
markReminderReceived(); // Provider acceptance is not device receipt.
```

```ts
await astrBot.chat("Please update Goalset and reschedule tasks");
```

### Correct

```ts
const delivery = await deliverPwaPayload(targets, payload, send);
if (delivery.acceptedIds.length) markProviderAccepted();
// Service worker independently calls /api/pwa/receipt.
```

```ts
await astrBotGateway.sendText(goalsetGeneratedReply);
// Goalset command service remains the only scheduler/mutation authority.
```

```ts
// Wrong: leftover credentials silently activate an unwanted channel.
if (pwaIsConfigured()) enqueuePwaReminder();

// Correct: selection gates the already-configured transport.
if (reminderChannelIsEnabled("pwa") && pwaIsConfigured()) enqueuePwaReminder();
```

```ts
// Wrong: SDK debug can include private message bodies.
logger: { debug: console.debug }

// Correct: keep lifecycle info, but suppress payload-level debug and sanitize errors.
logger: { debug: () => undefined, error: (message) => console.error(sanitizedQqError(message)) }
```

```ts
// Wrong: every owner message is assumed to describe a task.
await parseScheduleCommand(message.content, date, snapshot);

// Correct: reserved channel controls terminate before scheduling.
const control = parseQqControlCommand(message.content);
if (control) return replyWithoutMutation(control.reply);
```
