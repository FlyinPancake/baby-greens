# baby-greens design

baby-greens tracks sprout and microgreen batches at home. It tells you what each jar or tray needs
today, sends a reminder when a task is due, and records how each batch turned out.

It runs as an installable PWA on desktop and phones, backed by a self-hosted Rust server. Login goes
through an existing OIDC provider. Growing for sale, orders, and customers are out of scope.

This document describes how the app works now. [roadmap.md](roadmap.md) lists what's done and what
might come next.

## Stack

### Server

| Concern | Choice |
| --- | --- |
| HTTP | Axum on tokio |
| Database | Postgres through SQLx, with compile-time checked queries |
| Login | OIDC authorization code flow with PKCE (`openidconnect` crate) |
| Sessions | `tower-sessions` with the SQLx Postgres store |
| API spec | `utoipa` with `utoipa-axum`, served at `/api/v1/openapi.json`, docs at `/api/v1/docs` |
| Push | `web-push` crate with VAPID keys |
| Scheduler | a tokio task that runs once a minute |
| Static files | the server serves the built frontend, so it ships as one binary |

### Frontend

| Concern | Choice |
| --- | --- |
| Build | Vite, React, TypeScript |
| Routing | TanStack Router |
| Server state | TanStack Query, with the cache saved to IndexedDB. Ticks, snoozes, and harvests go through an outbox while offline. See "Offline" |
| PWA | `vite-plugin-pwa` (Workbox) |
| UI | Tailwind 4 with [neobrutalism.dev](https://www.neobrutalism.dev) components (shadcn registry, green style), Space Grotesk, lucide icons |
| API client | `openapi-fetch` with types from `openapi-typescript` |

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

## API

The JSON API lives under `/api/v1`, so a future native app can stay on `v1` while the API changes.
`/api/health` and the `/auth/*` browser redirects aren't versioned.

| Method | Path | What it does |
| --- | --- | --- |
| GET, PATCH | `/me` | The signed-in user. PATCH sets the timezone and quiet hours |
| GET | `/plants` | The library, with each plant's source: `builtin`, `custom`, or `override` |
| GET, PUT, DELETE | `/plants/{slug}` | Read, save, or delete a custom plant. PUT validates first |
| GET, POST | `/batches` | List batches (optionally by status or container), or start one |
| GET | `/batches/{id}` | A batch with its step history, upcoming windows, and open tasks |
| POST | `/batches/{id}/discard` | Stop an active batch |
| GET, POST | `/containers` | List the household's jars and trays with what grows in them, or add one |
| GET, PATCH, DELETE | `/containers/{id}` | Read, rename, archive, or restore one. DELETE only works without history |
| GET | `/tasks?due_before=` | Open tasks on active batches, soonest first |
| POST | `/tasks/{id}/complete?done_at=` | Finish a care chore, or advance the batch for an advance task. `done_at` backdates it, up to 7 days |
| POST | `/tasks/{id}/snooze` | Push a task back, up to a week. It gets a new reminder when the snooze ends |
| POST | `/batches/{id}/harvests` | Log a cut from a harvested batch: grams, an optional 1 to 5 rating, and notes |
| DELETE | `/harvests/{id}` | Remove a logged harvest |
| GET | `/stats/plants` | Per plant: harvested batches, seed and yield grams, yield ratio, average rating and days |
| GET | `/push/key` | The VAPID public key, or null when push is off |
| POST, DELETE | `/push/subscriptions` | Save or forget this device's push subscription |
| POST | `/push/test` | Send a test notification to all of your devices |

Errors share one body: `{ "error": "<code>", "message"?: "...", "problems"?: [...] }`. Validation
failures are 422 with `problems`, unreadable bodies are 400, and state conflicts such as finishing a
done task are 409 with a code like `task_done`.

Every handler goes through `utoipa_axum::routes!`, so a route can't exist without being in the spec.
`baby-greens-server openapi` prints the spec without a database. `mise run api:gen` writes it to
`server/openapi.json` and regenerates `web/src/lib/api.gen.ts`, and `mise run check` fails when
either is out of date.

## Reminders

The server sends Web Push messages signed with a VAPID key from `VAPID_PRIVATE_KEY`. Without it,
push stays off and the rest of the app works the same. `mise run vapid:key` prints a new key.

A job in the server process runs every minute. In one transaction it claims open tasks on active
batches that are due (counting snoozes) and not yet notified, using `FOR UPDATE SKIP LOCKED`. It
skips people inside their quiet hours, which use their timezone and may run past midnight, and marks
the rest as notified. Then it sends each person one message for all of their due tasks: one task
names the step and opens its batch, several become a list that opens today. A push service answering
404 or 410 removes the subscription. Tasks count as notified even for people without devices, so
turning push on later doesn't replay old reminders. Snoozing clears the notified mark.

The service worker (`web/src/sw.ts`) precaches the app, shows pushed messages, and opens the right
page when one is tapped. Push needs a secure context, so it works on localhost and over https, but
not over plain http on the tailnet.

## Offline

The Query cache is saved to IndexedDB (`baby-greens-cache`) and kept for 7 days, so the app opens
with the last data it loaded. After it's restored, every query refetches, so a stale copy never
outlives a working connection.

Ticking a task, snoozing it, and logging a harvest go through an outbox (`web/src/lib/outbox.ts`),
also in IndexedDB. Online with an empty queue, a change goes straight out. Otherwise it waits, and
the screen applies it right away: ticked tasks disappear and snoozed ones move. The outbox sends in
order when the browser comes online, when the app becomes visible, and every 30 seconds. It stops at
the first change that has to wait:

- A network error, 5xx, or 429 leaves the change queued for the next try.
- A 401 leaves it queued and shows a banner asking the user to sign in again. The queue survives the
  login redirect and goes out once the session is back.
- Any other 4xx drops the change and tells the user why, for example a task someone else already
  finished.

Ticks carry the time they were made as `done_at`, so a step that syncs late still starts when the
user actually moved the jar. The server clamps it to the step's start. Signing out asks first when
changes are waiting, then clears the queue, so they can't go out under another account.

Everything else, like starting a batch or editing a plant, needs a connection and says so.

## Authentication

The server never stores passwords. All interactive login goes through the OIDC provider (Pocket ID,
Authelia, Authentik, or any provider with discovery). The server reads `OIDC_ISSUER_URL`,
`OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` from its config and finds the endpoints through
discovery.

### Web (backend for frontend)

The server is a confidential OIDC client. The browser never sees an OIDC token.

1. `GET /auth/login?return_to=/path` stores a PKCE verifier, state, nonce, and return path in the
   session and redirects to the provider. A login that isn't finished expires after 10 minutes.
2. `GET /auth/callback` checks the state, exchanges the code, and verifies the ID token signature,
   issuer, audience, and nonce.
3. The server creates or updates the user, keyed by `(issuer, subject)`. Email is display data only,
   because a user can change it at the provider.
4. The server rotates the session id, stores the user id, and sets an `HttpOnly`, `SameSite=Lax`
   cookie, plus `Secure` when `PUBLIC_URL` is https. Sessions last 30 days and renew on use. They
   live in the `tower_sessions` schema, which the session store creates itself.
5. The callback redirects to the stored return path. On failure it redirects to
   `/?auth_error=<code>` with one of `provider`, `expired`, `state_mismatch`, `not_allowed`, or
   `failed`.
6. `POST /auth/logout` deletes the session and returns 204. It doesn't sign the user out at the
   provider (RP-initiated logout), because Dex doesn't support it.

For CSRF protection, the server rejects any request other than GET whose `Origin` header doesn't
match the app's origin.

Only `/api` and `/auth` sit behind the session layer. Sessions save on every request so the idle
timeout counts from the last visit, and static files would otherwise re-send the session cookie too.
When the service worker fetched assets during a login, one of those responses could land after the
callback and put the old, signed-out session id back.

When a session expires while the PWA is offline, the app keeps showing cached data and queued ticks.
When it's back online, it gets a 401, sends the user through login, and then replays the queue.

### Access control

`OIDC_ALLOWED_GROUP` is optional. If set, the callback rejects users whose `groups` claim doesn't
contain it. Without it, anyone the provider authenticates gets an account.

Handlers get the signed-in user from the `AuthUser` extractor, which reads the session cookie. API
tokens and bearer tokens on the roadmap only add code inside it.

## Data model

```text
User           (id, oidc_issuer, oidc_subject, display_name, email?, timezone,
                quiet_start?, quiet_end?, created_at)
Session        (managed by tower-sessions)
PushSubscription (id, user, endpoint, p256dh, auth, user_agent, created_at)

CustomPlant    (slug PK, definition jsonb, created_by?, created_at, updated_at)
Container      (id, name unique ignoring case, kind: jar|tray, color?, notes, created_by?,
                created_at, archived_at?)
Batch          (id, user, plant_slug, plant jsonb, current_step, container_id, seed_g,
                started_at, status, notes)
BatchStep      (batch, step_index, started_at, ended_at?)
Task           (id, batch, step_index, kind: advance|care, action, due_at, overdue_at?,
                snoozed_until?, done_at?, notified_at?)
Harvest        (id, batch, harvested_at, yield_g, rating, notes)
```

Custom plants and containers are shared by every account on the server. A container holds one active
batch at a time, which a partial unique index enforces. Containers with past batches get archived
instead of deleted, so history keeps its jar. A batch stores a copy of its plant's definition from
when it started, so editing a plant only affects new batches. `BatchStep` records how long each step
actually took. All times are `timestamptz`. The server uses `User.timezone` for quiet hours and for
showing "today". The `kind` and `status` columns are Postgres enums mapped to Rust enums with
`sqlx::Type`.

## Plant definitions

```json
{
  "name": "Mung bean sprouts",
  "name_lat": "Vigna radiata",
  "kind": "sprout",
  "seed_g": 60,
  "steps": [
    { "action": "soak", "duration_min": "8h", "duration_max": "12h" },
    {
      "action": "sprout",
      "duration_min": "2d",
      "duration_max": "5d",
      "care": [{ "action": "rinse", "every": "12h" }],
      "note": "Keep them dark and weighed down for thicker, straighter sprouts."
    },
    { "action": "harvest" }
  ]
}
```

- `kind` is `sprout` or `microgreen`. `name_lat`, `seed_g` (grams for one jar or tray), and a step's
  `note` are optional.
- Step actions are `soak`, `sprout`, `blackout`, `light`, and `harvest`. Care actions are `rinse`,
  `water`, and `mist`.
- Durations use [humantime](https://docs.rs/humantime) syntax, like `30m`, `12h`, `4d`, or `1d 12h`,
  and must be longer than zero. Saved definitions use humantime's own formatting, so `36h` comes
  back as `1day 12h`.
- Every step except the last needs `duration_min`. `duration_max` is optional and can't be shorter.
  The last step must be `harvest`, with no durations or care. Each care action can appear once per
  step.
- Unknown fields are errors, so a typo doesn't get silently ignored. Validation reports every
  problem with a path, like `steps[1].duration_max: must not be shorter than duration_min`.

Built-in plants live in `server/plants/builtin.json`, keyed by slug, and get compiled in with
`include_str!`. A test checks that every entry is valid, and the server parses them at startup.
Slugs are lowercase letters, digits, and single hyphens. A custom plant with a built-in slug
overrides it, and deleting the custom plant restores the built-in one.

### Scheduling

The user advances a batch by hand. When the batch enters a step, the server creates:

- an advance task, due at `duration_min` and overdue at `duration_max`. Its action is the next
  step's action, like "move to light" or "harvest".
- the first task for each care chore, due one interval after the step starts.

Finishing a chore schedules the next one, one interval after it was actually done. Advancing closes
the step's open tasks and records the step's end time. Advancing into `harvest` ends the batch. The
planned harvest window is the sum of the earlier steps' minimum and maximum durations.

## Server layout

```text
server/
  migrations/
  src/
    main.rs        startup and shutdown
    lib.rs         AppState and the router
    api/           handlers and utoipa annotations
    auth/          OIDC flow, sessions, AuthUser extractor
    domain/        plant format, library, and scheduling, no HTTP or SQL
    db/            SQLx queries
    jobs/          the per-minute scheduler
    notify/        Notifier trait and the web push implementation
  plants/
    builtin.json   the built-in plant library
```

`domain/` turns a plant and a step start time into tasks. It has no I/O, so unit tests cover it
fully. It's where bugs are most likely.

The reminder job in `jobs/` sends through the `Notifier` trait in `notify/`, which delivers one
message to one push subscription. Web push is the only implementation. Tests use a fake notifier.

## Deployment

[docs/deploy.md](deploy.md) is the step-by-step guide. In short:

- The `Dockerfile` builds one image with the server and the built frontend, on distroless
  `cc-debian13`. cargo-chef keeps the dependency build in its own layer. The image's health check
  runs `baby-greens-server healthcheck`, which calls `/api/health`, because the image has no curl.
- `deploy/compose.yaml` runs the app and Postgres 18 with the data on a volume. The `backup` Compose
  profile adds a service that writes a `pg_dump` archive daily and deletes old ones.
- An existing reverse proxy terminates HTTPS and forwards to the app. Service workers and push
  require HTTPS, and the OIDC redirect URI uses that HTTPS origin.
- Authentik is the provider. It has to sign ID tokens with an RSA key, because the app only accepts
  RS256.
- GitHub Actions runs the checks, the server tests, the SQLx metadata check, and the browser tests.
  On pushes to `main` and `v*` tags it publishes `ghcr.io/<owner>/<repo>` for `linux/amd64`.

CI builds use SQLx offline mode. `cargo sqlx prepare` writes query metadata to `.sqlx/`, which is
committed, so `cargo build` doesn't need a running database. Tests still run against a Postgres
service container.

The server trusts the system certificate store on top of the bundled roots, so a provider behind a
private CA works once `SSL_CERT_FILE` points at the CA. It only needs outbound access to the
provider and, for push delivery, the push services.

For development and CI, a Dex container with static test users stands in for the real provider. The
server only depends on standard OIDC, so the dev setup doesn't need to match production.
