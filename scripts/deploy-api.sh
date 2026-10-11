#!/usr/bin/env bash
# Operator driver (run from the repo checkout). Packages the COMMITTED API tree,
# verifies it locally, uploads it and lets the server-side script publish it.
# The API is published before the static build so an old client never sees a 404.
# Usage: scripts/deploy-api.sh RELEASE_ID [switch]
set -Eeuo pipefail
id=${1:?release id}
mode=${2:-deploy}
[[ "$id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo 'Invalid release id' >&2; exit 2; }
[[ "$mode" == deploy || "$mode" == switch ]] || { echo 'Invalid mode' >&2; exit 2; }
scripts=$(cd -- "$(dirname -- "$0")" && pwd)
repo=$(cd -- "$scripts/.." && pwd)
host=${HAIRPLAY_HOST:-root@49.232.129.114}
key=${HAIRPLAY_SSH_KEY:-$HOME/.ssh/keychain_deploy_ed25519}
out=/tmp/hairplay-api-$id
remote=/tmp/hairplay-api-deploy-$id

cd "$repo"
[[ -z "$(git status --porcelain -- server client/src/core client/src/static package.json package-lock.json)" ]] || {
  echo 'Backend sources have uncommitted changes; commit before publishing' >&2; exit 2; }
[[ ! -e "$out" ]] || { echo "Stale package directory $out" >&2; exit 2; }
mkdir -p "$out/tree"
# The archive paths are the API contract's allowlist (see API_ALLOWED in release.py):
# the backend modules, the catalogue index and the catalogue pictures. `pack-api`
# re-checks every member, so a path added here without a rule is refused. The H5-only
# placeholder icon is committed but is not part of the API contract.
git archive --format=tar HEAD package.json package-lock.json \
  server/ark.mjs server/auth.mjs server/auth-worker.mjs server/mail.mjs \
  client/src/core/catalog.json client/src/static/catalog \
  ':(exclude)client/src/static/catalog/placeholder.svg' | tar -x -C "$out/tree"
python3 "$scripts/release.py" pack-api "$out/tree" "$out/manifest.json" --archive "$out/release.tgz"
python3 "$scripts/release.py" verify-archive "$out/release.tgz" "$out/manifest.json" --kind api
shasum -a 256 "$out/release.tgz" "$out/manifest.json"

ssh -i "$key" -o BatchMode=yes "$host" "mkdir -p $remote"
scp -i "$key" -o BatchMode=yes "$out/release.tgz" "$out/manifest.json" "$scripts/release.py" \
  "$scripts/release-api-remote.sh" "$host:$remote/"
# The server-side checker must be byte-identical to the one verified locally: the
# remote script runs the remote copy, so a mismatch would deploy unchecked data.
local_hash=$(shasum -a 256 "$scripts/release.py" "$scripts/release-api-remote.sh" | awk '{print $1}')
remote_hash=$(ssh -i "$key" -o BatchMode=yes "$host" \
  "cd $remote && shasum -a 256 release.py release-api-remote.sh | awk '{print \$1}'")
printf 'SHA-256 (checker release.py, then publisher release-api-remote.sh)\nlocal:\n%s\nremote:\n%s\n' \
  "$local_hash" "$remote_hash"
[[ "$local_hash" == "$remote_hash" ]] || {
  echo 'Server-side release tooling differs from the local copy; refusing to publish' >&2; exit 2; }
ssh -i "$key" -o BatchMode=yes "$host" \
  "bash $remote/release-api-remote.sh $mode $id $remote/manifest.json $remote/release.py $remote/release.tgz"
