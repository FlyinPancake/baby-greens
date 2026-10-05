# baby-greens plan

baby-greens tracks sprout and microgreen batches at home. It tells you what each jar or tray needs
today, sends a reminder when a task is due, and records how each batch turned out.

It runs as an installable PWA on desktop and phones, backed by a self-hosted Rust server. Login goes
through an existing OIDC provider.

## Scope

Home growing only. No selling, orders, or customer features.

### MVP

1. Plant library. Each plant is a JSON definition listing its steps (soak, sprout, blackout, light,
   harvest), with a duration range and repeating care chores for each step. See "Plant definitions"
   below. Built-in plants ship in the binary. Users can add custom plants or override built-in ones.
2. Batches. Pick a plant, seed weight, container, and start time. The user advances the batch from
   step to step, and the server generates reminders and chores for the current step.
3. Today view. Due tasks across all batches, ticked off one at a time.
4. Reminders. Web push when a task is due, with snoozing and quiet hours.
5. Harvest log. Date, yield in grams, a 1 to 5 rating, and notes. Yield ratio (grams harvested per
   gram of seed) per plant.

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
| API spec | `utoipa` with `utoipa-axum`, served at `/api/v1/openapi.json`, docs at `/api/v1/docs` |
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
| GET | `/me` | The signed-in user |
| GET | `/plants` | The library, with each plant's source: `builtin`, `custom`, or `override` |
| GET, PUT, DELETE | `/plants/{slug}` | Read, save, or delete a custom plant. PUT validates first |
| GET, POST | `/batches` | List batches (optionally by status), or start one |
| GET | `/batches/{id}` | A batch with its step history, upcoming windows, and open tasks |
| POST | `/batches/{id}/discard` | Stop an active batch |
| GET | `/tasks?due_before=` | Open tasks on active batches, soonest first |
| POST | `/tasks/{id}/complete` | Finish a care chore, or advance the batch for an advance task |

Errors share one body: `{ "error": "<code>", "message"?: "...", "problems"?: [...] }`. Validation
failures are 422 with `problems`, unreadable bodies are 400, and state conflicts such as finishing a
done task are 409 with a code like `task_done`.

Every handler goes through `utoipa_axum::routes!`, so a route can't exist without being in the spec.
`baby-greens-server openapi` prints the spec without a database. `mise run api:gen` writes it to
`server/openapi.json` and regenerates `web/src/lib/api.gen.ts`, and `mise run check` fails when
either is out of date.

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
6. `POST /auth/logout` deletes the session and returns 204. RP-initiated logout at the provider is
   not built yet, because Dex doesn't support it. Add it when it matters for the real provider.

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

CustomPlant    (slug PK, definition jsonb, created_by?, created_at, updated_at)
Batch          (id, user, plant_slug, plant jsonb, current_step, container, seed_g,
                started_at, status, notes)
BatchStep      (batch, step_index, started_at, ended_at?)
Task           (id, batch, step_index, kind: advance|care, action, due_at, overdue_at?,
                snoozed_until?, done_at?, notified_at?)
Harvest        (id, batch, harvested_at, yield_g, rating, notes)
```

Custom plants are shared by every account on the server. A batch stores a copy of its plant's
definition from when it started, so editing a plant only affects new batches. `BatchStep` records
how long each step actually took. All times are `timestamptz`. The server uses `User.timezone` for
quiet hours and for showing "today". The `kind` and `status` columns are Postgres enums mapped to
Rust enums with `sqlx::Type`.

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

Domain code emits events such as "task became due" and "step changed". `notify/` listens to these
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
3. The plant definition format, a built-in library of 15 plants, custom plant storage, and domain
   scheduling logic with tests.
4. Plant, batch, and task API with utoipa-axum under `/api/v1`, the generated TypeScript client, the
   today view, batch pages, and a JSON editor for plants.
5. PWA install, push subscription, the scheduler, snoozing, and quiet hours.
6. Offline support (saved Query cache, queued mutations, replay after re-login) and the harvest log
   with yield stats.
7. Deploy behind Tailscale or Caddy against the real provider.
8. Later: API tokens, the MQTT bridge for HA, and bearer token support for a native app.
