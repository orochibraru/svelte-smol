# my-app

Minimal SvelteKit app wired to [`@orochibraru/svelte-smol`](../../), which
compiles it into a single standalone executable.

## Develop

```sh
bun install
bun run dev
```

## Build

```sh
bun run build
```

Produces `build/server` (the executable) plus `build/client/` and
`build/prerendered/`. Run it from anywhere:

```sh
./build/server            # listens on 0.0.0.0:3000
PORT=8080 ./build/server
```

The `bunfig.toml` here sets `[run] bun = true` so `vite build` runs under the
Bun runtime, which the compile step needs.

## Docker

```sh
docker build -t my-app .
docker run --rm -p 3000:3000 my-app
# or: docker compose up --build
```

Build and runtime images must share a libc — see the note in the
[`Dockerfile`](./Dockerfile).
