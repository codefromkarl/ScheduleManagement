# Private HTTPS Deployment Contract

## Scenario: Publish Goalset through Cloudflare Tunnel

### 1. Scope / Trigger

Apply this contract whenever Docker Compose or Cloudflare Tunnel exposes the single-owner SQLite service outside a trusted LAN. The public hostname is `goalset.codefromkarl.xyz`; the root `codefromkarl.xyz` remains owned by the Firefly site.

### 2. Signatures

```bash
pnpm db:backup
docker compose --profile pwa up -d --build goalset-app goalset-pwa-worker
docker compose up -d goalset-tunnel
docker compose config --no-interpolate --quiet
```

The Tunnel runtime reads `/etc/cloudflared/config.yml`, maps `goalset.codefromkarl.xyz` to `http://127.0.0.1:3000`, and ends ingress with `http_status:404`.

### 3. Contracts

- `AUTH_DISABLED=false` is mandatory before `goalset-tunnel` starts.
- `AUTH_SECRET` and `OWNER_PASSWORD` remain in ignored `.env.local`; never add them to Compose YAML or Git.
- Tunnel credentials remain under ignored `web/cloudflared/`, with the directory owner-readable and the JSON credential mode `600`.
- `goalset-tunnel` runs as `GOALSET_UID:GOALSET_GID` so it can read the credential without broadening file permissions.
- The app health check probes public `/login` plus writable SQLite files. It must not probe an authenticated API without a session.
- Anonymous HTTPS `/` redirects to `/login`; authenticated `/`, `/api/status`, and `/manifest.webmanifest` return `200`.
- Take an online SQLite backup before rebuilding, migrating, changing DNS, or starting the Tunnel.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| `AUTH_DISABLED=true` | Block Tunnel startup; do not expose the app |
| Health probe targets protected `/api/status` | Container remains unhealthy; change the probe to `/login` |
| Tunnel UID cannot read `config.yml` or credential JSON | Tunnel restarts with `permission denied`; align UID/GID, do not chmod secrets world-readable |
| Tunnel has no active connector | Public request returns Cloudflare `530`/`1016`; keep app private and inspect Tunnel logs |
| Anonymous schedule/status API request | `401` |
| Valid owner login over HTTPS | Login `200`, session cookie is `Secure`, protected request `200` |
| Mobile viewport | `documentElement.scrollWidth <= innerWidth` and no console/page errors |

### 5. Good / Base / Bad Cases

- Good: backup succeeds, auth is enabled, app is healthy, four Tunnel connections register, anonymous traffic redirects, and a real mobile browser can log in.
- Base: the app and PWA worker remain usable locally while the Tunnel is stopped or DNS is propagating.
- Bad: start the Tunnel while authentication is disabled, weaken credential permissions to make the container start, or overwrite the root-domain deployment.

### 6. Tests Required

- `docker compose config --no-interpolate --quiet` parses the exact candidate Compose file.
- SQLite `quick_check` returns `ok` and `foreign_key_check` returns no rows before and after deployment.
- App and PWA worker are running; app health is `healthy`; Tunnel status is `healthy` with active connections.
- Anonymous HTTPS root redirects to `/login`; anonymous protected API returns `401`.
- HTTPS login creates a secure owner session; authenticated root/status/manifest return `200`.
- Headless Chromium at 1440px and 390px renders the Dashboard without console errors or horizontal overflow.

### 7. Wrong vs Correct

#### Wrong

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://127.0.0.1:3000/api/status"]
```

This fails after authentication is restored because the probe has no owner session.

#### Correct

```yaml
healthcheck:
  test: ["CMD-SHELL", "test -w /data/goalset.db && node -e \"fetch('http://127.0.0.1:3000/login').then(r=>{if(!r.ok)process.exit(1)})\""]
```

Keep authenticated API behavior in a separate deployment smoke test with a real login cookie.
