#!/usr/bin/env bash
# Package an already-built H5 directory. No upload, release creation or live switch.
set -euo pipefail
[[ $# == 2 ]] || { echo "Usage: $0 H5_BUILD NEW_OUTPUT_DIRECTORY" >&2; exit 2; }
scripts=$(cd -- "$(dirname -- "$0")" && pwd)
build=$(cd -- "$1" && pwd)
out=$2
# Exclusive output directory prevents confusing a stale artifact with this run.
mkdir -- "$out"
node "$scripts/../client/scripts/check-public-build.mjs" "$build"
python3 "$scripts/release.py" pack "$build" "$out/manifest.json" --archive "$out/release.tgz"
python3 "$scripts/release.py" verify-archive "$out/release.tgz" "$out/manifest.json"
echo "PACKAGE_OK: $out (upload only after all checks succeed)"
