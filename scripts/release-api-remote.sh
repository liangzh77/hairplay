#!/usr/bin/env bash
# Linux server only. Publishes the HairPlay API tree under /opt/hairplay and
# atomically switches `current`, then restarts hairplay-api.service.
# Does not edit Caddy, does not touch /var/lib/hairplay (except a root-only
# backup before a new release runs its migrations) and never deletes a release.
# Usage: $0 deploy|switch RELEASE_ID MANIFEST CHECKER [ARCHIVE]
set -Eeuo pipefail
if [[ $# != 4 && $# != 5 ]]; then
  echo "Usage: $0 deploy|switch RELEASE_ID MANIFEST CHECKER [ARCHIVE]" >&2
  exit 2
fi
mode=$1 id=$2 manifest=$3 checker=$4 archive=${5:-}
# Production values. The HAIRPLAY_API_* overrides exist only for the isolated
# rehearsal (scripts/test_api_remote_publish.py) and must never be set on the
# live host.
root=${HAIRPLAY_API_ROOT:-/opt/hairplay}
data=${HAIRPLAY_API_DATA:-/var/lib/hairplay}
secrets=${HAIRPLAY_API_SECRETS:-/etc/hairplay}
restart=${HAIRPLAY_API_RESTART:-systemctl restart hairplay-api.service}
health=${HAIRPLAY_API_HEALTH:-http://127.0.0.1:8777/hairplay/api/session}
[[ "$id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || exit 2
[[ "$mode" == deploy || "$mode" == switch ]] || exit 2
[[ -f "$manifest" && -f "$checker" && -d "$root/releases" && ! -L "$root/releases" ]] || exit 2
[[ -d "$root" && ! -L "$root" && -d "$data" && ! -L "$data" ]] || exit 2
# Serialize our own publishers; running two of these would race the symlink.
exec 9>"$root/.publish.lock"
flock -n 9 || { echo 'Another API publisher is running' >&2; exit 2; }
[[ -L "$root/current" ]] || { echo 'current must already be a symlink' >&2; exit 2; }
old_target=$(readlink "$root/current")
[[ "$old_target" =~ ^releases/[0-9]{8}T[0-9]{6}Z$ && -d "$root/$old_target" && ! -L "$root/$old_target" ]] || exit 2
release="$root/releases/$id"
staging=''
link_dir=''
switched=0
backup=''
users_before=$(sqlite3 "$data/auth.sqlite" 'SELECT count(*) FROM users;')
[[ "$users_before" =~ ^[0-9]+$ ]] || { echo 'Cannot read the account count' >&2; exit 2; }

atomic_switch() {
  # Same parent/filesystem as current; mv -T replaces the link itself and never
  # leaves a moment without a valid `current`.
  local target=$1
  link_dir=$(mktemp -d "$root/.link.XXXXXXXX")
  ln -s "$target" "$link_dir/current"
  mv -Tf -- "$link_dir/current" "$root/current"
  rmdir "$link_dir"
  link_dir=''
}
# The service is already restarted when this runs; a slow start is retried, but a
# crash loop fails fast. The quota ledger must be untouched by the release switch.
# The health contract is the complete response — HTTP 200 and exactly this body —
# so a line match cannot accept a page that also carries something else.
api_health() {
  local i status response
  [[ -z ${health_file:-} ]] || rm -f -- "$health_file"
  response=$(mktemp) || return 1
  health_file=$response
  for i in $(seq 1 20); do
    if status=$(curl --noproxy '*' -sS --max-time 5 -o "$response" -w '%{http_code}' "$health" 2>/dev/null); then
      if [[ "$status" == 200 ]] && printf '%s' '{"account":null}' | cmp -s - "$response"; then
        rm -f -- "$response"
        [[ $(sqlite3 "$data/auth.sqlite" 'SELECT count(*) FROM users;') == "$users_before" ]] || {
          echo 'Account count changed during publish' >&2; return 1; }
        return 0
      fi
    fi
    sleep 1
  done
  rm -f -- "$response"
  echo 'API health check failed' >&2
  return 1
}
cleanup() {
  [[ -z ${health_file:-} ]] || rm -f -- "$health_file"
  [[ -z "$staging" ]] || rm -rf -- "$staging"
  [[ -z "$link_dir" ]] || rm -rf -- "$link_dir"
  return 0
}
rollback() {
  local status=$?
  trap - ERR
  trap '' HUP INT TERM
  if [[ "$switched" == 1 ]]; then
    echo "Publish failed; restoring $old_target" >&2
    atomic_switch "$old_target" || { echo 'ROLLBACK SWITCH FAILED' >&2; exit 1; }
    bash -c "$restart" || true
    api_health || { echo 'ROLLBACK HEALTH CHECK FAILED' >&2; exit 1; }
    echo "API_PUBLISH_ROLLED_BACK current=$(readlink "$root/current")" >&2
    [[ ! -d "$release" ]] || echo "Failed release kept for inspection: $release (re-publish with a new id)" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap rollback ERR
trap 'false' HUP INT TERM

if [[ "$mode" == deploy ]]; then
  [[ -f "$archive" && ! -e "$release" && ! -L "$release" ]] || {
    echo 'Archive missing or release already exists; refusing overwrite' >&2; exit 2;
  }
  python3 "$checker" verify-archive "$archive" "$manifest" --kind api
  staging=$(mktemp -d "$root/releases/.staging-$id.XXXXXXXX")
  # Only verified regular files, copied explicitly. Never tar extractall.
  python3 - "$archive" "$staging" <<'PY'
import pathlib, sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for member in archive:
        path = pathlib.Path(sys.argv[2]) / member.name
        if member.isdir():
            path.mkdir(parents=True, exist_ok=True)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('xb') as output:
                output.write(archive.extractfile(member).read())
PY
  python3 "$checker" verify-tree "$staging" "$manifest" --kind api
  find "$staging" -type d -exec chmod 755 {} +
  find "$staging" -type f -exec chmod 644 {} +
  # The persistent quota DB and the credentials live outside the release and are
  # only ever linked in, so a rollback cannot lose accounts or images.
  ln -sfn "$data" "$staging/.data"
  ln -sfn "$secrets" "$staging/.secrets"
  if [[ -f "$root/$old_target/package-lock.json" ]] && cmp -s "$root/$old_target/package-lock.json" "$staging/package-lock.json"; then
    cp -a "$root/$old_target/node_modules" "$staging/node_modules"
  else
    ( cd "$staging" && npm ci --omit=dev --no-audit --no-fund )
  fi
  # The new code must import before it is allowed to serve traffic.
  ( cd "$staging" && node -e "import('./server/ark.mjs').then(m=>{if(typeof m.createApp!=='function')process.exit(1)})" ) >/dev/null
  mkdir -p "$data/backups"
  backup="$data/backups/auth-before-api-$id.sqlite"
  [[ ! -e "$backup" ]] || { echo 'Backup path already exists' >&2; exit 2; }
  sqlite3 "$data/auth.sqlite" ".backup '$backup'"
  chmod 600 "$backup"
  chown root:root "$backup"
  mv -T -- "$staging" "$release"
  staging=''
else
  [[ -d "$release" && ! -L "$release" ]] || exit 2
  # An explicit switch/rollback must supply that version's own trusted manifest.
  # The deployed release additionally has node_modules and the .data/.secrets links.
  python3 "$checker" verify-api-release "$release" "$manifest"
fi

atomic_switch "releases/$id"
switched=1
bash -c "$restart"
api_health
trap - ERR
printf 'API_PUBLISH_OK current=%s previous=%s backup=%s\n' \
  "$(readlink "$root/current")" "$old_target" "$backup"
