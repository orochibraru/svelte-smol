# native-addon

A SvelteKit app that depends on [`sharp`](https://sharp.pixelplumbing.com/), a
native (`.node`) module. `bun build --compile` can't embed native addons, so
this example uses `adapter({ compile: false })`: the build emits a plain
`build/index.js` bundle (dependencies left external) that runs under `bun`
alongside `node_modules`.

## Develop

```sh
bun install
bun run dev
```

## Build

```sh
bun run build
```

Produces:

```text
build/
├── index.js       # the server bundle, run with `bun`
├── healthcheck    # still a compiled binary
├── client/
└── prerendered/
```

## Run

`build/index.js` resolves its dependencies from `node_modules` (looked up from
the file's own location, so the working directory doesn't matter). Keep
`node_modules` next to `build/` — or anywhere up the tree — and start it:

```sh
bun run ./build/index.js        # listens on 0.0.0.0:3000
PORT=8080 bun run ./build/index.js
```

Open <http://localhost:3000> — the image on the page is rendered per request by
`sharp` on the server.

## Docker

```sh
docker compose up --build
```

The runtime image installs production dependencies (`--production`) so `sharp`'s
prebuilt binary for the image's libc is present next to `build/`.
