#!/usr/bin/env bash
# Build the Bun-free binary from a SvelteKit app's server output.
#
#   ./build.sh                          # the bundled example app
#   ./build.sh ~/Dev/my-app             # any SvelteKit project
#   ./build.sh ~/Dev/my-app --no-build  # reuse its existing .svelte-kit output
#
# The app's adapter does not matter: this consumes `.svelte-kit/output/server`,
# which Vite writes whatever the adapter is.
set -euo pipefail
cd "$(dirname "$0")"

APP="../examples/compiled-app"
BUILD_APP=1
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD_APP=0 ;;
    -h | --help)
      sed -n '2,9p' "$0" | cut -c3-
      exit 0
      ;;
    -*)
      echo "unknown option: $arg" >&2
      exit 1
      ;;
    *) APP="$arg" ;;
  esac
done

[ -d "$APP" ] || {
  echo "no such directory: $APP" >&2
  exit 1
}
# Absolute, because the generated entry imports the app by full path.
APP="$(cd "$APP" && pwd)"
echo "==> app: $APP"

if [ "$BUILD_APP" = 1 ]; then
  (cd "$APP" && bun run build)
fi

OUT="$APP/.svelte-kit/output/server"
for f in index.js manifest-full.js; do
  [ -f "$OUT/$f" ] || {
    echo "missing $OUT/$f — build the app first (or drop --no-build)" >&2
    exit 1
  }
done

# The same token swap the adapter itself uses (see ../index.ts): the entry
# names SERVER and MANIFEST, the build resolves them to this app's output.
sed -e "s|\"SERVER\"|\"$OUT/index.js\"|" \
  -e "s|\"MANIFEST\"|\"$OUT/manifest-full.js\"|" \
  handler.js > .entry.js

# Bundler only; nothing Bun-specific ends up in the output. Verified
# interchangeable with `npx esbuild .entry.js --bundle --format=esm
# --platform=node --outfile=bundle.js` (byte-identical responses).
#
# A real app fails here if it imports something QuickJS has no answer for —
# `bun:sqlite`, a native .node addon, a `node:` builtin LLRT lacks. That
# failure is the point: it prices the binding work (see README).
bun build --target=node --format=esm .entry.js --outfile bundle.js

# llrt_core from source: the published 0.8.1-beta crate has no `Response.body`,
# which streaming needs. Its build script wants `bundle/js` (an esbuild of
# LLRT's own TS shims) that a plain git dependency can't produce, so vendor the
# tag once and generate it. `vendor/` is gitignored.
if [ ! -d vendor/llrt/bundle/js ]; then
  git clone --quiet --depth 1 --branch v0.9.0-beta https://github.com/awslabs/llrt vendor/llrt
  (cd vendor/llrt && bun install && node build.mjs)
fi

cargo build --release

BIN="$PWD/target/release/sveltekit-quickjs"
echo
echo "built: $BIN ($(du -h "$BIN" | cut -f1))"
echo "run:   (cd $APP && ASSETS_DIR=.svelte-kit/output PORT=3000 $BIN)"
