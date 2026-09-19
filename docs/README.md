# Documentation

The guides in this folder, in reading order:

1. [Getting started](getting-started.md) — install the adapter, build, run the
   binary.
2. [Adapter options](options.md) — every option `adapter()` accepts.
3. [Environment variables](env.md) — runtime settings, their defaults, and
   `envPrefix`.
4. [Deployment](deployment.md) — Docker, cross-compilation, serving assets.
5. [Health check](health-check.md) — the `healthcheck` binary and `/_health`.
6. [Reverse proxy](reverse-proxy.md) — `ORIGIN`, forwarded headers, client IPs.
7. [Native addons](native-addons.md) — shipping `sharp` & co. with
   `compile: false`.
8. [Architecture](architecture.md) — what `adapt()` does and how the runtime is
   put together.

This file is the index when someone reads the repo on GitHub; the docs site
ignores it. The site's categories, order, titles and icons come from
[`config.json`](config.json).
