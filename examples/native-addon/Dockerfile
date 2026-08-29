# `compile: false` ships a `build/index.js` bundle with its dependencies left
# external, so the runtime image needs the Bun runtime *and* a `node_modules`
# (here: `sharp` plus its prebuilt native binaries for this image's libc).

FROM oven/bun:1 AS build

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --ignore-scripts

COPY . .
RUN bun run build

# Reduce node_modules to production dependencies for the runtime image.
RUN rm -rf node_modules && bun install --production --ignore-scripts

FROM oven/bun:1-slim

WORKDIR /app

COPY --from=build --chown=bun:bun /app/build ./build
COPY --from=build --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/package.json ./package.json

USER bun

ENV HOST=0.0.0.0 PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=2s --retries=3 \
	CMD ["./build/healthcheck"]

CMD ["bun", "run", "./build/index.js"]
