# QQ Bot capability research

## Date

2026-08-20

## Initial evidence

- Tencent's maintained `tencent-connect/botpy` repository describes a QQ Bot SDK based on the official Bot Open Platform API. Its examples include a direct-message reply example (`demo_dms_reply.py`), and its current README documents AppID/AppSecret authentication and friend/group messaging examples.
- Tencent's `tencent-connect/qqbot-nodejs` repository documents C2C message handling, text replies, WebSocket and Webhook transport modes, and a C2C streaming-message path. The repository README says streaming messages are limited to C2C private chat.
- The product should use the official QQ Bot application model, not personal-account automation. The first implementation must verify the actual private-message capability, intent configuration, sandbox rules, message limits, and account eligibility in the QQ developer console.

## Product implication

- QQ should be treated as an inbound command channel for the scheduling service.
- Bind the first version to one allowlisted QQ user identity; reject or ignore other senders.
- Keep the website chat path independent so the scheduling dashboard remains usable if the QQ connection is unavailable.

## Sources

- https://github.com/tencent-connect/botpy
- https://github.com/tencent-connect/qqbot-nodejs/blob/main/README.zh-CN.md
- https://bot.q.qq.com/wiki/
