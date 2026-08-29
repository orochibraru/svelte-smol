FROM oven/bun:1-alpine AS build

WORKDIR /app

COPY package.json bun.lock /app/

RUN bun install --frozen-lockfile --ignore-scripts

COPY . .

RUN bun run build

FROM debian:slim

WORKDIR /app

COPY --from=build /app/build /app/build

CMD ["/app/build/server"]
