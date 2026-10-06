# Deploying baby greens

The production stack is in `deploy/compose.yaml`:

- `app`, the server image from GHCR. It serves the API and the frontend on port 3000 and applies
  database migrations on startup.
- `postgres`, with its data in the `postgres-data` volume.
- `backup`, optional, which dumps the database once a day into `deploy/backups/`.

Your reverse proxy terminates HTTPS and forwards to the app. Sign-in goes through Authentik.

## 1. The image

Every push to `main` runs the checks and tests in GitHub Actions, then publishes
`ghcr.io/<owner>/<repo>` with these tags:

- `latest`
- `sha-<short commit>`
- the version, for `v*` tags

The image is for `linux/amd64`.

To build the image yourself instead, run `docker build -t baby-greens .` from the repository root.

## 2. Authentik

Create a provider, then an application that uses it.

1. **Applications → Providers → Create → OAuth2/OpenID Provider.**
   - **Client type**: Confidential.
   - **Redirect URIs**: `https://<your host>/auth/callback`. The app always uses `PUBLIC_URL` plus
     `/auth/callback`, so the two must match exactly.
   - **Signing key**: pick a certificate, for example "authentik Self-signed Certificate". Without
     one, Authentik signs ID tokens with HS256, and the app only accepts RS256.
   - **Scopes**: keep the defaults, `openid`, `email`, and `profile`. Authentik's `profile` mapping
     includes the `groups` claim that `OIDC_ALLOWED_GROUP` checks.
   - **Subject mode**: keep the default. Accounts are keyed by issuer and subject, so changing it
     later gives everyone a new, empty account.
2. **Applications → Applications → Create.** Pick the provider. The slug ends up in the issuer URL,
   for example `baby-greens`.
3. Copy the provider's **Client ID**, **Client Secret**, and **OpenID Configuration Issuer** into
   `.env`. Copy the issuer exactly, trailing slash included, because discovery compares it character
   for character.

There are two ways to limit who can sign in. You can bind a group or policy to the application in
Authentik, so others never get past Authentik. Or you can set `OIDC_ALLOWED_GROUP` to a group name,
so baby greens turns others away after login. Either works, and the first gives the clearer error.

Signing out of baby greens ends its own session only. While the Authentik session lasts, "Sign in"
goes straight back in without a password prompt.

## 3. The server

Copy `deploy/compose.yaml` and `deploy/.env.example` to the server, rename the example to `.env`,
and fill it in. You'll need:

- a Postgres password: `openssl rand -hex 24`
- a VAPID key for reminders: `docker run --rm <image> vapid-key`. Keep it. A new key cuts off every
  device that turned reminders on, and each one has to turn them on again.

Then start the stack:

```sh
docker compose up -d
docker compose logs -f app
```

The app needs to reach Authentik at the issuer URL from inside its container: for discovery at
startup, and for every login. If Authentik runs on the same host behind the same proxy, check that
its hostname resolves and routes from inside a container, not only from your browser. If discovery
fails, the app exits with "could not run OIDC discovery", and Docker restarts it until Authentik is
up.

If Authentik's certificate comes from a private CA, mount the CA and point `SSL_CERT_FILE` at it in
the `app` service:

```yaml
    environment:
      SSL_CERT_FILE: /etc/baby-greens/ca.pem
    volumes:
      - ./ca.pem:/etc/baby-greens/ca.pem:ro
```

Public CAs keep working alongside it.

## 4. The reverse proxy

Forward the whole host to the app. `APP_BIND` in `.env` sets where the app listens, `127.0.0.1:3000`
by default. The app needs:

- HTTPS. Session cookies are `Secure` when `PUBLIC_URL` is https. Service workers, installing the
  app, and push only work on https.
- The site at the root of its host. The app doesn't support running under a path.
- The `Origin` header passed through unchanged. The app rejects requests other than GET whose origin
  doesn't match `PUBLIC_URL`. Every common proxy passes it by default.

Caddy:

```caddy
greens.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

nginx:

```nginx
server {
    listen 443 ssl;
    server_name greens.example.com;
    # ssl_certificate and friends

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
```

Traefik, with the proxy and the app on a shared Docker network: remove `ports` from the `app`
service, attach the network, and add labels:

```yaml
    labels:
      traefik.enable: "true"
      traefik.http.routers.baby-greens.rule: Host(`greens.example.com`)
      traefik.http.routers.baby-greens.tls.certresolver: <your resolver>
      traefik.http.services.baby-greens.loadbalancer.server.port: "3000"
```

`https://<your host>/api/health` should answer `{"database":true}`.

## Upgrades

```sh
docker compose pull app
docker compose up -d app
```

Migrations run when the new version starts. They only move forward, so take a backup before an
upgrade if you might want to go back. To upgrade on your own schedule, set `BABY_GREENS_IMAGE` to a
`sha-<commit>` tag instead of `latest`.

## Backups

The `backup` service is off by default. Turn it on with `COMPOSE_PROFILES=backup` in `.env`, then
run `docker compose up -d`. Leave it off if something else already backs up the host, for example
snapshots of Docker's volumes. To turn it off again, clear `COMPOSE_PROFILES` and remove the
container with `docker compose --profile backup rm -sf backup`.

The service writes `backups/baby_greens-<date>.dump` daily at `BACKUP_HOUR` in `TZ`, and deletes
dumps older than `BACKUP_KEEP_DAYS`. They're `pg_dump` custom-format archives. Copy them off the
machine with whatever you already use. A backup on the same disk doesn't survive that disk.

To restore one, stop the app and replace the database:

```sh
docker compose stop app
docker compose exec -T postgres pg_restore --clean --if-exists -U baby_greens -d baby_greens \
  < backups/baby_greens-2026-10-06.dump
docker compose start app
```

To make a backup by hand:

```sh
docker compose exec -T postgres pg_dump --format=custom -U baby_greens baby_greens > manual.dump
```
