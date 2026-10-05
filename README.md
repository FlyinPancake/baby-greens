# baby-greens

A tracker for sprout and microgreen batches at home. See [docs/plan.md](docs/plan.md) for the design
and milestones.

## Layout

- `server/` is the Axum API. It uses SQLx with Postgres and applies migrations from
  `server/migrations/` on startup.
- `web/` is the React PWA, built with Vite, TanStack Router, TanStack Query, and Tailwind.
- `compose.yaml` runs Postgres 18 and Dex for development.
- `dev/dex.yaml` configures Dex as a stand-in OIDC provider.

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

`mise run serve` builds the frontend and serves it from the Rust server, the way production runs.

Run `mise tasks` to list the other tasks, such as `check`, `test`, `migrate:add`, and `db:reset`.

## Dev login

Dex has two test users, `grower@example.com` and `second@example.com`. Both use the password
`password`. Login is part of milestone 2.

## Versions

- sqlx stays on 0.8 because `tower-sessions-sqlx-store` 0.15 requires it. Upgrade both together.
- The schema uses `uuidv7()`, which needs Postgres 18 or newer.
