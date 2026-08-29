FROM oven/bun:1 AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .
RUN bun run build

FROM debian:bookworm-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& useradd --system --create-home --uid 10001 app

WORKDIR /app
COPY --from=build --chown=app:app /app/build ./build

USER app

ENV HOST=0.0.0.0 PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=2s --retries=3 \
	CMD ["./build/healthcheck"]

CMD ["./build/server"]
