#!/usr/bin/env python3
"""Linux/GNU mv test of the exact production switch and rollback functions.
Run locally on Linux or copy beside release-remote.sh into a server /tmp directory.
Only touches a TemporaryDirectory; never touches the live site.
"""
from pathlib import Path
import subprocess
import tempfile

source = Path(__file__).with_name('release-remote.sh').read_text()
functions = source[source.index('atomic_switch() {'):source.index('trap cleanup EXIT')]
with tempfile.TemporaryDirectory(prefix='hairplay-atomic-test-') as temp:
    script = r'''
set -euo pipefail
root=$1
mkdir -p "$root/releases/20260101T000000Z" "$root/releases/20260102T000000Z"
ln -s releases/20260101T000000Z "$root/current"
link_dir='' staging='' switched=0
old_target=releases/20260101T000000Z
rollback_target=$old_target
''' + functions + r'''
trap cleanup EXIT
python3 - "$root" <<'PY' &
import os, pathlib, sys
root = pathlib.Path(sys.argv[1])
allowed = {'releases/20260101T000000Z', 'releases/20260102T000000Z'}
count = 0
while not (root / 'done').exists():
    assert os.readlink(root / 'current') in allowed
    assert (root / 'current').is_dir()
    count += 1
print(f'ATOMIC_READER_OK observations={count}')
PY
reader=$!
for ((i=0; i<100; i++)); do
  atomic_switch releases/20260102T000000Z
  atomic_switch releases/20260101T000000Z
done
touch "$root/done"
wait "$reader"
'''
    # A fresh non-conditional shell preserves Bash errexit/ERR semantics.
    subprocess.run(['bash', '-s', '--', temp], input=script, text=True, check=True)
    rollback_script = 'set -euo pipefail\nroot=$1\nlink_dir="" staging="" switched=1\nold_target=releases/20260101T000000Z\nrollback_target=$old_target\n' + functions + '''
trap cleanup EXIT
trap rollback ERR
atomic_switch releases/20260102T000000Z
false
'''
    result = subprocess.run(['bash', '-s', '--', temp], input=rollback_script, text=True)
    assert result.returncode != 0, 'Forced health failure must fail command'
    assert (Path(temp) / 'current').readlink().as_posix() == 'releases/20260101T000000Z'
    assert not list(Path(temp).glob('.link.*'))
    # After first SW rollout, the automatic rollback must select the clone with
    # reset worker, not the historical directory lacking a worker.
    (Path(temp) / 'releases' / '20260103T000000Z').mkdir()
    reset_script = rollback_script.replace('rollback_target=$old_target',
                                           'rollback_target=releases/20260103T000000Z')
    result = subprocess.run(['bash', '-s', '--', temp], input=reset_script, text=True)
    assert result.returncode != 0
    assert (Path(temp) / 'current').readlink().as_posix() == 'releases/20260103T000000Z'
    print('ATOMIC_SWITCH_OK switches=200; forced-failure old/reset-clone rollback=PASS (mv -T)')
