#!/usr/bin/env bash
# Build the Bun-free binary: bundle kit's server output, bake it into Rust.
set -euo pipefail
cd "$(dirname "$0")"

# The example app must be built first — this consumes its .svelte-kit output.
(cd ../examples/compiled-app && bun run vite build)

# Bundler only; nothing Bun-specific ends up in the output. Verified
# interchangeable with `npx esbuild handler.js --bundle --format=esm
# --platform=node --outfile=bundle.js` (byte-identical responses).
bun build --target=node --format=esm handler.js --outfile bundle.js

# llrt_core from source: the published 0.8.1-beta crate has no `Response.body`,
# which streaming needs. Its build script wants `bundle/js` (an esbuild of
# LLRT's own TS shims) that a plain git dependency can't produce, so vendor the
# tag once and generate it. `vendor/` is gitignored.
if [ ! -d vendor/llrt/bundle/js ]; then
  git clone --quiet --depth 1 --branch v0.9.0-beta https://github.com/awslabs/llrt vendor/llrt
  (cd vendor/llrt && bun install && node build.mjs)
fi

cargo build --release
echo "built: spike/target/release/sveltekit-quickjs ($(du -h target/release/sveltekit-quickjs | cut -f1))"
