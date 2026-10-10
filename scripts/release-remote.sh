#!/usr/bin/env bash
# Linux server only. Does not edit/reload Caddy. All inputs are supplied explicitly.
# When adding a SW to a worker-less old release, require HAIRPLAY_CACHE_RESET_RELEASE_ID,
# HAIRPLAY_CACHE_RESET_MANIFEST and HAIRPLAY_CACHE_RESET_SHA256 for failure rollback.
set -Eeuo pipefail
if [[ $# != 4 && $# != 5 ]]; then
  echo "Usage: $0 deploy|switch RELEASE_ID MANIFEST CHECKER [ARCHIVE]" >&2
  exit 2
fi
mode=$1 id=$2 manifest=$3 checker=$4 archive=${5:-}
root=/srv/sites/liangz77.cn/hairplay
[[ "$id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || exit 2
[[ "$mode" == deploy || "$mode" == switch ]] || exit 2
[[ -f "$manifest" && -f "$checker" && -d "$root/releases" && ! -L "$root/releases" ]] || exit 2
# Serialize our own publishers; no Caddy reload or config edits.
exec 9>"$root/.publish.lock"
flock -n 9 || { echo 'Another publisher is running' >&2; exit 2; }
[[ -L "$root/current" ]] || { echo 'current must already be a symlink' >&2; exit 2; }
old_target=$(readlink "$root/current")
[[ "$old_target" =~ ^releases/[0-9]{8}T[0-9]{6}Z$ && -d "$root/$old_target" && ! -L "$root/$old_target" ]] || exit 2
rollback_target=$old_target
release="$root/releases/$id"
# Parse the verified manifest as JSON, not text grep: an escaped key such as
# hairplay-images-sw\\u002ejs is valid JSON and must not bypass reset checks.
manifest_has_sw=$(python3 - "$manifest" <<'PY'
import json,sys
with open(sys.argv[1]) as f: data=json.load(f)
print('1' if 'hairplay-images-sw.js' in data else '0')
PY
)
old_has_sw=0
[[ ! -f "$root/$old_target/hairplay-images-sw.js" ]] || old_has_sw=1
# On the first image-SW deployment, automatic failure rollback must point to an
# old-UI clone that serves an unregistering worker at the SAME URL. Restoring
# the worker-less historical directory leaves an installed worker active.
if [[ "$old_has_sw" == 0 && "$manifest_has_sw" == 1 ]]; then
  reset_id=${HAIRPLAY_CACHE_RESET_RELEASE_ID:-}
  reset_manifest=${HAIRPLAY_CACHE_RESET_MANIFEST:-}
  reset_sha=${HAIRPLAY_CACHE_RESET_SHA256:-}
  [[ "$reset_id" =~ ^[0-9]{8}T[0-9]{6}Z$ && "$reset_id" != "$id" && -f "$reset_manifest" && "$reset_sha" =~ ^[a-f0-9]{64}$ ]] || { echo 'Verified cache-reset rollback release required' >&2; exit 2; }
  reset_dir="$root/releases/$reset_id"
  [[ -d "$reset_dir" && ! -L "$reset_dir" ]] || exit 2
  python3 "$checker" verify-tree "$reset_dir" "$reset_manifest"
  python3 - "$root/$old_target" "$reset_dir" "$reset_sha" <<'PY'
import hashlib,pathlib,sys
old,reset=map(pathlib.Path,sys.argv[1:3])
def hashes(root):return {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
original=hashes(old);clone=hashes(reset)
if clone.pop('hairplay-images-sw.js',None)!=sys.argv[3]:
 raise ValueError('Reset worker SHA-256 mismatch')
if original!=clone:
 raise ValueError('Reset rollback differs from the verified old release')
if b'self.registration.unregister()' not in (reset/'hairplay-images-sw.js').read_bytes():
 raise ValueError('Reset worker does not unregister')
PY
  rollback_target="releases/$reset_id"
fi
staging=''
link_dir=''
switched=0

atomic_switch() {
  local target=$1
  # Same parent/filesystem as current. GNU mv -T replaces the link itself,
  # never follows current and never creates an unlink/relink visibility gap.
  link_dir=$(mktemp -d "$root/.link.XXXXXXXX")
  ln -s "$target" "$link_dir/current"
  mv -Tf -- "$link_dir/current" "$root/current"
  rmdir "$link_dir"
  link_dir=''
}
cleanup() {
  [[ -z "$staging" ]] || rm -rf -- "$staging"
  [[ -z "$link_dir" ]] || rm -rf -- "$link_dir"
  return 0
}
rollback() {
  local status=$?
  trap - ERR
  trap '' HUP INT TERM
  if [[ "$switched" == 1 ]]; then
    echo "Restoring $rollback_target with mv -T" >&2
    atomic_switch "$rollback_target" || { echo 'ROLLBACK FAILED' >&2; exit 1; }
    [[ $(readlink "$root/current") == "$rollback_target" ]] || exit 1
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
  python3 "$checker" verify-archive "$archive" "$manifest"
  staging=$(mktemp -d "$root/releases/.staging-$id.XXXXXXXX")
  # Only verified regular files, copied explicitly. Never tar extractall / resource forks.
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
  python3 "$checker" verify-tree "$staging" "$manifest"
  find "$staging" -type d -exec chmod 755 {} +
  find "$staging" -type f -exec chmod 644 {} +
  mv -T -- "$staging" "$release"
  staging=''
else
  [[ -d "$release" && ! -L "$release" ]] || exit 2
  # Explicit rollback/switch must supply that version's own trusted manifest.
  python3 "$checker" verify-tree "$release" "$manifest"
fi
# Final check of actual published directory, not just build or tar contents.
python3 "$checker" verify-tree "$release" "$manifest"
actual_has_sw=0
[[ ! -f "$release/hairplay-images-sw.js" ]] || actual_has_sw=1
[[ "$actual_has_sw" == "$manifest_has_sw" ]] || { echo 'Image worker disagrees with release manifest' >&2; exit 2; }
if [[ "$old_has_sw" == 1 && "$actual_has_sw" == 0 ]]; then
 echo 'Publishing a worker-less release is unsafe; use a verified old-UI clone with cache-reset worker' >&2; exit 2
fi
switched=1
atomic_switch "releases/$id"
[[ $(readlink "$root/current") == "releases/$id" ]]
python3 "$checker" verify-http https://liangz77.cn/hairplay/ "$manifest"
trap - ERR HUP INT TERM
printf 'PUBLISH_OK current=%s previous=%s auto_rollback=%s (atomic mv -T)\n' "releases/$id" "$old_target" "$rollback_target"
