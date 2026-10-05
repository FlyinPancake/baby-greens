# baby-greens plan

baby-greens tracks sprout and microgreen batches at home. It tells you what each jar or tray needs
today, sends a reminder when a task is due, and records how each batch turned out.

It runs as an installable PWA on desktop and phones, backed by a self-hosted Rust server. Login goes
through an existing OIDC provider.

## Scope

Home growing only. No selling, orders, or customer features.

### MVP

1. Seed library. Each variety has default timings (soak hours, rinses per day, blackout days,
   harvest window, seed grams per tray). Users can edit defaults and add varieties.
2. Batches. Pick a variety, seed weight, container, and start time. The server computes stage dates
   and generates tasks.
3. Today view. Due tasks across all batches, ticked off one at a time.
4. Reminders. Web push when a task is due, with snoozing and quiet hours.
5. Harvest log. Date, yield in grams, a 1 to 5 rating, and notes. Yield ratio (grams harvested per
   gram of seed) per variety.

### Later

- Photos per batch, shown as a timeline.
- Seed inventory that subtracts what each batch uses.
- Problem notes and a checklist for common issues (root hairs vs. mold).
- Succession planning ("start a radish tray every 4 days").
- Shared households.
- Home Assistant integration over MQTT.
- Native mobile app using the same API.

## Stack

### Server

| Concern | Choice |
| --- | --- |
| HTTP | Axum on tokio |
| Database | Postgres through SQLx, with compile-time checked queries |
| Login | OIDC authorization code flow with PKCE (`openidconnect` crate) |
| Sessions | `tower-sessions` with the SQLx Postgres store |
| API spec | `utoipa`, served at `/api/openapi.json` |
| Push | `web-push` crate with VAPID keys |
| Scheduler | a tokio task that runs once a minute |
| Static files | the server serves the built frontend, so it ships as one binary |

### Frontend

| Concern | Choice |
| --- | --- |
| Build | Vite, React, TypeScript |
| Routing | TanStack Router |
| Server state | TanStack Query, with the cache saved to IndexedDB and mutations queued while offline |
| PWA | `vite-plugin-pwa` (Workbox) |
| UI | Tailwind and shadcn/ui, phone layout first |
| API client | generated from the OpenAPI spec (`openapi-typescript` or `orval`) |

### Rejected alternatives

- Loco. Not wanted. Plain Axum keeps every piece visible.
- specta or ts-rs. Lighter than utoipa, but an OpenAPI spec lets a future native app and HA scripts
  generate clients.
- SQLite. Simpler to run, but Postgres is the preferred database. Postgres also gives `timestamptz`,
  real enums, and a fresh database per test through `#[sqlx::test]`.
- Local-first sync engines (Zero, PowerSync, Electric). They work with Postgres, but each needs its
  own sync service. Offline writes here are simple and safe to replay, so a mutation queue is
  enough.
- Tauri. An installed PWA already gives a desktop window.

## Authentication

The server never stores passwords. All interactive login goes through the OIDC provider (Pocket ID,
Authelia, Authentik, or any provider with discovery). The server reads `OIDC_ISSUER_URL`,
`OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` from its config and finds the endpoints through
discovery.

### Web (backend for frontend)

The server is a confidential OIDC client. The browser never sees an OIDC token.

1. `GET /auth/login` stores a PKCE verifier, state, and nonce in the session and redirects to the
   provider.
2. `GET /auth/callback` checks the state, exchanges the code, and verifies the ID token signature,
   issuer, audience, and nonce.
3. The server creates or updates the user, keyed by `(issuer, subject)`. Email is display data only,
   because a user can change it at the provider.
4. The server starts a session and sets an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Sessions
   last 30 days and renew on use.
5. `POST /auth/logout` deletes the session. If the provider supports RP-initiated logout, the server
   redirects there too.

For CSRF protection, the server rejects any request other than GET whose `Origin` header doesn't
match the app's origin.

When a session expires while the PWA is offline, the app keeps showing cached data and queued ticks.
When it's back online, it gets a 401, sends the user through login, and then replays the queue.

### Access control

`OIDC_ALLOWED_GROUP` is optional. If set, the callback rejects users whose `groups` claim doesn't
contain it. Without it, anyone the provider authenticates gets an account.

### Later clients

- Native app. A public OIDC client with PKCE that sends `Authorization: Bearer <access token>`. The
  server checks JWT access tokens against the provider's JWKS. If the provider issues opaque access
  tokens, the server calls the userinfo endpoint instead and caches the result for a few minutes.
- Home Assistant and scripts. Personal API tokens created in the app's settings. The database stores
  only a hash of each token. Each token has a name and a last-used time, and the user can revoke it.

One Axum extractor, `AuthUser`, accepts a session cookie, a bearer token, or an API token. Handlers
only see the resolved user. Build the cookie path first, but put the extractor in place on day one
so the other two paths only add code inside it.

## Data model

```text
User           (id, oidc_issuer, oidc_subject, display_name, email?, timezone,
                quiet_start?, quiet_end?, created_at)
Session        (managed by tower-sessions)
ApiToken       (id, user, name, token_hash, last_used_at?, created_at)   -- later
PushSubscription (id, user, endpoint, p256dh, auth, user_agent, created_at)

Variety        (id, user?, name, kind: sprout|microgreen, soak_hours,
                rinses_per_day, blackout_days, harvest_day_min, harvest_day_max,
                seed_g_per_tray)
Batch          (id, user, variety, container, seed_g, started_at, status, notes)
Stage          (id, batch, kind: soak|blackout|light|growing, starts_at, ends_at)
Task           (id, batch, kind: rinse|water|move|harvest, due_at, snoozed_until?,
                done_at?, notified_at?)
Harvest        (id, batch, harvested_at, yield_g, rating, notes)
```

`Variety.user` is null for built-in varieties. All times are `timestamptz`. The server uses
`User.timezone` for quiet hours and for showing "today". The `kind` and `status` columns are
Postgres enums mapped to Rust enums with `sqlx::Type`.

## Server layout

```text
server/
  migrations/
  src/
    main.rs        config, router, startup
    api/           handlers and utoipa annotations
    auth/          OIDC flow, sessions, AuthUser extractor
    domain/        scheduling logic, no HTTP or SQL
    db/            SQLx queries
    jobs/          the per-minute scheduler
    notify/        Notifier trait and the web push implementation
```

`domain/` turns a variety and a start time into stages and tasks. It has no I/O, so unit tests cover
it fully. It's where bugs are most likely.

Domain code emits events such as "task became due" and "stage changed". `notify/` listens to these
through a `Notifier` trait. Web push is the first implementation. APNs or FCM for a native app, and
MQTT for HA, become further implementations without changes to the scheduling code.

## Deployment

`compose.yaml` runs the server and Postgres, with the database on a volume. A nightly `pg_dump`
handles backups. The server only needs outbound internet access for push delivery.

CI builds use SQLx offline mode. `cargo sqlx prepare` writes query metadata to `.sqlx/`, which is
committed, so `cargo build` doesn't need a running database. Tests still run against a Postgres
service container.

Service workers and push require HTTPS, so the server sits behind `tailscale serve` or Caddy with a
DNS-challenge certificate. The OIDC redirect URI must use that HTTPS origin.

For development and CI, a Dex container with static test users stands in for the real provider. The
server only depends on standard OIDC, so the dev setup doesn't need to match production.

## Milestones

1. Workspace setup. Cargo crate, Vite app, compose file with Postgres and Dex, SQLx migrations,
   config loading.
2. OIDC login, sessions, the `AuthUser` extractor, the Origin check, and a `/api/me` endpoint. The
   React app shows a login button and the signed-in user.
3. Domain scheduling logic with tests, and a seed library of about 15 varieties.
4. Batch and task API with utoipa, the generated TypeScript client, and the today view.
5. PWA install, push subscription, the scheduler, snoozing, and quiet hours.
6. Offline support (saved Query cache, queued mutations, replay after re-login) and the harvest log
   with yield stats.
7. Deploy behind Tailscale or Caddy against the real provider.
8. Later: API tokens, the MQTT bridge for HA, and bearer token support for a native app.
