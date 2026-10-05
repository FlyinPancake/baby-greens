# baby-greens

A tracker for sprout and microgreen batches at home. See [docs/plan.md](docs/plan.md) for the design
and milestones.

## Layout

- `server/` is the Axum API. It uses SQLx with Postgres and applies migrations from
  `server/migrations/` on startup.
- `server/plants/builtin.json` is the built-in plant library. The plan's "Plant definitions" section
  describes the format.
- `web/` is the React PWA, built with Vite, TanStack Router, TanStack Query, and Tailwind.
- `compose.yaml` runs Postgres 18 and Dex for development.
- `dev/dex.yaml.tpl` configures Dex as a stand-in OIDC provider. Dex fills in the issuer and
  redirect URI from the environment.

## Setup

You need Rust, Docker, and [mise](https://mise.jdx.dev). mise installs bun, watchexec, and sqlx-cli
at the versions in `mise.toml`, loads `.env`, and runs the project tasks.

```sh
mise install
cp .env.example .env
mise run up        # Postgres on :5432, Dex on :5556
mise run install   # frontend dependencies
```

Then start both dev servers:

```sh
mise run dev
```

This runs the API on <http://127.0.0.1:3000> and the app on <http://localhost:5173>. Vite proxies
`/api` and `/auth` to the API. Vite hot-reloads frontend changes. `mise watch` rebuilds and restarts
the API when anything in `server/src`, `server/migrations`, the Cargo files, or `.env` changes.

To run one half on its own, use `mise run dev:server` (restarting) or `mise run server` (single
run), and `mise run web`.

The API docs are at <http://localhost:5173/api/v1/docs>. After changing an API handler or type, run
`mise run api:gen` to update `server/openapi.json` and the frontend's generated types.

### Testing on a phone

`mise run dev:tailnet` runs the same stack on this machine's Tailscale name instead of localhost.
Open `http://<machine>.<tailnet>.ts.net:5173` on any device in your tailnet. Vite listens on the
Tailscale address and proxies the API, which stays on 127.0.0.1. Dex listens on the Tailscale
address too, because login redirects the browser to it. `mise.tailnet.toml` reads the name and
address from `tailscale` and sets `PUBLIC_URL` and `OIDC_ISSUER_URL` to match.

In this mode `localhost:5173` doesn't answer, and the browser tests, which use localhost, won't
pass. Run `mise run up` to move Dex back to localhost before plain `mise run dev`. Service workers
and push need HTTPS, which this plain HTTP setup doesn't give; that comes with milestone 5.

`mise run serve` builds the frontend and serves it from the Rust server, the way production runs.

Browser tests live in `web/e2e`. They sign in through Dex as `second@example.com` and check the main
flows, plus that no page scrolls sideways at desktop, 375 px, and 320 px widths. Run
`mise run test:e2e:install` once to download Chromium, then `mise run test:e2e` with Postgres and
Dex up. The tests reuse `mise run dev` if it's running and start it if not. Batches they create are
discarded, so they stay in that user's history.

Run `mise tasks` to list the other tasks, such as `check`, `test`, `migrate:add`, and `db:reset`.

## Dev login

Dex has two test users, `grower@example.com` and `second@example.com`. Both use the password
`password`. The server runs OIDC discovery against `OIDC_ISSUER_URL` at startup, so start Dex with
`mise run up` before the server.

To use another provider, register a confidential client with the redirect URI
`<PUBLIC_URL>/auth/callback` and set the `OIDC_*` variables in `.env`.

## Versions

- sqlx stays on 0.8 because `tower-sessions-sqlx-store` 0.15 requires it. Upgrade both together.
- The schema uses `uuidv7()`, which needs Postgres 18 or newer.
- Queries use the `sqlx::query!` macros. After changing a query, run `mise run sqlx:prepare` and
  commit `server/.sqlx`, so builds without a database (CI, Docker) keep working.
