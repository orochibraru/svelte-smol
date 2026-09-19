# Getting Started

Turn a SvelteKit app into a single standalone executable in a few minutes.

## 1. Install

```bash
bun add -d @orochibraru/svelte-smol
```

## 2. Configure the adapter

```typescript
// svelte.config.js
import adapter from "@orochibraru/svelte-smol";

export default {
  kit: {
    adapter: adapter(),
  },
};
```

See [Adapter options](options.md) for everything `adapter()` accepts.

## 3. Build under Bun

The compile step calls `Bun.build`, so the build must run on the Bun runtime,
not Node. Either force it per command:

```bash
bun --bun vite build
```

or once for the project with a `bunfig.toml`, after which a plain
`bun run build` works:

```toml
[run]
bun = true
```

Loading the config alone works under Node, so `svelte-check`, the Svelte
language server and `svelte-kit sync` are unaffected.

## 4. Run it

```text
build/
├── server        # the compiled executable
├── healthcheck   # tiny probe binary, see Health check
├── client/       # static assets, served by the executable
└── prerendered/  # prerendered pages, served by the executable
```

```bash
./build/server
```

The executable finds `client/` and `prerendered/` relative to its own path, so
it runs from any working directory. It listens on `0.0.0.0:3000` by default —
see [Environment variables](env.md) to change that.

## What's supported

WebSockets, `read()` from `$app/server`, prerendering, Server-Sent Events and
server instrumentation (`instrumentation.server.ts`) all work. The one thing a
compiled binary can't embed is a native (`.node`) addon — see
[Native addons](native-addons.md).
