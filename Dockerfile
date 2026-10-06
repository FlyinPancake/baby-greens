# syntax=docker/dockerfile:1
# The production image: the Rust server with the built frontend, on a distroless base.
# Build it with `docker build -t baby-greens .` from the repository root.

ARG RUST_VERSION=1.98
ARG BUN_VERSION=1

FROM oven/bun:${BUN_VERSION} AS web
WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

# cargo-chef caches the dependency build in its own layer, so source changes don't rebuild it.
FROM lukemathwalker/cargo-chef:latest-rust-${RUST_VERSION}-trixie AS chef
WORKDIR /app/server

FROM chef AS plan
COPY server/ ./
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS server
COPY --from=plan /app/server/recipe.json ./
RUN cargo chef cook --release --recipe-path recipe.json
COPY server/ ./
# Queries are checked against the metadata in .sqlx, so the build needs no database.
ENV SQLX_OFFLINE=true
RUN cargo build --release --bin baby-greens-server

FROM gcr.io/distroless/cc-debian13:nonroot
COPY --from=server /app/server/target/release/baby-greens-server /usr/local/bin/baby-greens-server
COPY --from=web /app/web/dist /app/web
ENV WEB_DIST=/app/web \
    BIND_ADDR=0.0.0.0:3000 \
    RUST_LOG=baby_greens_server=info,tower_http=info
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
    CMD ["baby-greens-server", "healthcheck"]
ENTRYPOINT ["baby-greens-server"]
