#!/usr/bin/env python3
"""Linux-only isolated rehearsal of the API publish path.

Never touches /opt/hairplay, /var/lib/hairplay, /etc/hairplay, systemd or Caddy.
It uses the documented HAIRPLAY_API_* overrides, a temporary sandbox root and a
stub "restart" hook, and asserts: happy publish, refusal to overwrite a release,
health-failure rollback to the previous release (wrong body, the right body plus
an extra line, and a non-200 endpoint), and tampered-archive rejection.

The stub service serves the exact bytes the stub restarter leaves in the health
file, so the publisher's health contract is exercised end to end: a body that is
not exactly `{"account":null}`, or a non-200 status, must refuse the release.
Run it on a Linux host (the production one is fine) as root:
    python3 scripts/test_api_remote_publish.py
"""
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import tarfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parent))
import release  # noqa: E402

SCRIPTS = Path(__file__).resolve().parent
SOURCE = (SCRIPTS / 'release-api-remote.sh').read_text()
OK_ID = '20270101T000000Z'
BROKEN_ID = '20270102T000000Z'
EXTRA_ID = '20270104T000000Z'
FAIL_ID = '20270105T000000Z'
OLD_ID = '20260101T000000Z'
BROKEN_BODY = '{"account":"broken"}'
OK_BODY = '{"account":null}'


EMPTY_LOCK = ('{"name":"hairplay-api","version":"1.0.0","lockfileVersion":3,"requires":true,'
              '"packages":{"":{"name":"hairplay-api","version":"1.0.0"}}}')


def api_tree(root, lockfile='{"lockfileVersion":3}'):
    (root / 'server').mkdir(parents=True, exist_ok=True)
    (root / 'client/src/core').mkdir(parents=True, exist_ok=True)
    (root / 'package.json').write_text('{"name":"hairplay-api"}')
    (root / 'package-lock.json').write_text(lockfile)
    for name in ('ark.mjs', 'auth.mjs', 'mail.mjs'):
        (root / 'server' / name).write_text('export function createApp(){}\n')
    (root / 'client/src/core/catalog.json').write_text('[]')
    return root


def account_count(path):
    with sqlite3.connect(path) as db:
        return db.execute('SELECT count(*) FROM users').fetchone()[0]


def main():
    for tool in ('mv', 'flock', 'sqlite3', 'curl', 'node', 'python3'):
        if shutil.which(tool) is None:
            print(f'SKIP: {tool} not available')
            return 0
    if subprocess.run(['mv', '--version'], capture_output=True).returncode != 0:
        print('SKIP: GNU mv required (run on Linux)')
        return 0
    failures = []
    with tempfile.TemporaryDirectory(prefix='hairplay-api-rehearsal-') as tmp:
        tmp = Path(tmp)
        root = tmp / 'opt'
        data = tmp / 'var'
        secrets = tmp / 'etc'
        health = tmp / 'health.json'
        for path in (root / 'releases', data, secrets):
            path.mkdir(parents=True)
        (data / 'auth.sqlite').write_bytes(b'')
        with sqlite3.connect(data / 'auth.sqlite') as db:
            db.execute('CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT UNIQUE)')
            db.executemany('INSERT INTO users(email) VALUES(?)', [('a@example.com',), ('b@example.com',)])
        old = root / 'releases' / OLD_ID
        api_tree(old)
        (old / 'node_modules').mkdir()
        (old / 'node_modules/.keep').write_text('old dependencies\n')
        (old / '.data').symlink_to(data)
        (old / '.secrets').symlink_to(secrets)
        (root / 'current').symlink_to(f'releases/{OLD_ID}')

        # The stub service is reachable over real HTTP, so the health contract
        # (HTTP 200 and one exact body) is exercised rather than approximated.
        class HealthHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path != '/session':
                    self.send_error(404)
                    return
                try:
                    body = health.read_bytes()
                except OSError:
                    # No file means the stub service cannot answer: a non-200
                    # status with an empty body, like a crash-looping service.
                    self.send_error(503)
                    return
                self.send_response(200)
                self.send_header('content-type', 'application/json')
                self.send_header('content-length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        service = http.server.ThreadingHTTPServer(('127.0.0.1', 0), HealthHandler)
        threading.Thread(target=service.serve_forever, daemon=True).start()
        health_url = f'http://127.0.0.1:{service.server_address[1]}/session'

        # A stub service: healthy for the old release, a wrong body for BROKEN_ID,
        # the correct first line plus an extra line for EXTRA_ID — which a line
        # match would wrongly accept — and no answer at all for FAIL_ID.
        #
        # One quoted expansion per case pattern, and the paths in variables: a
        # pattern with an empty quoted string right before `)` ("releases/""$ID"")
        # misparses on bash 5.2 into a pattern that never matches, which would
        # silently fall through to the healthy branch and make every health
        # assertion here vacuous.
        restarter = tmp / 'restarter.sh'
        restarter.write_text(
            '#!/usr/bin/env bash\nset -euo pipefail\n'
            'target=$(readlink "$HAIRPLAY_API_ROOT/current")\n'
            'broken="releases/$HAIRPLAY_REHEARSAL_BROKEN_ID"\n'
            'extra="releases/$HAIRPLAY_REHEARSAL_EXTRA_ID"\n'
            'fail="releases/$HAIRPLAY_REHEARSAL_FAIL_ID"\n'
            'case "$target" in\n'
            '  "releases/20270108T000000Z") printf \'%s\\0\' \'{"account":null}\' > "$HAIRPLAY_REHEARSAL_HEALTH" ;;\n'
            '  "releases/20270109T000000Z") printf \'%s\\n\' \'{"account":null}\' > "$HAIRPLAY_REHEARSAL_HEALTH" ;;\n'
            '  "releases/20270110T000000Z") printf \'%s\\n\\n\' \'{"account":null}\' > "$HAIRPLAY_REHEARSAL_HEALTH" ;;\n'
            '  "$broken") printf %s \'{"account":"broken"}\' > "$HAIRPLAY_REHEARSAL_HEALTH" ;;\n'
            '  "$extra") printf \'%s\\n%s\' \'{"account":null}\' \'{"extra":true}\' > "$HAIRPLAY_REHEARSAL_HEALTH" ;;\n'
            '  "$fail") rm -f "$HAIRPLAY_REHEARSAL_HEALTH" ;;\n'
            '  *) printf %s \'{"account":null}\' > "$HAIRPLAY_REHEARSAL_HEALTH" ;;\n'
            'esac\n')
        health.write_text(OK_BODY)
        env = {**os.environ,
               'HAIRPLAY_API_ROOT': str(root),
               'HAIRPLAY_API_DATA': str(data),
               'HAIRPLAY_API_SECRETS': str(secrets),
               'HAIRPLAY_API_RESTART': f'bash {restarter}',
               'HAIRPLAY_API_HEALTH': health_url,
               'HAIRPLAY_REHEARSAL_BROKEN_ID': BROKEN_ID,
               'HAIRPLAY_REHEARSAL_EXTRA_ID': EXTRA_ID,
               'HAIRPLAY_REHEARSAL_FAIL_ID': FAIL_ID,
               'HAIRPLAY_REHEARSAL_HEALTH': str(health)}

        def publish(release_id, archive, manifest, mode='deploy'):
            return subprocess.run(
                ['bash', str(SCRIPTS / 'release-api-remote.sh'), mode, release_id,
                 str(manifest), str(SCRIPTS / 'release.py'), str(archive)],
                env=env, capture_output=True, text=True)

        def check(name, condition, detail=''):
            print(('PASS ' if condition else 'FAIL ') + name + (f' {detail}' if detail and not condition else ''))
            if not condition:
                failures.append(name)

        def pack(name, lockfile='{"lockfileVersion":3}'):
            tree = api_tree(tmp / f'tree-{name}', lockfile)
            archive, manifest = tmp / f'{name}.tgz', tmp / f'{name}.json'
            release.pack_api(tree, archive, manifest)
            return archive, manifest

        # 1. Happy publish: dependencies are reused, data/secrets are linked in.
        archive, manifest = pack('ok')
        result = publish(OK_ID, archive, manifest)
        check('happy publish exits 0', result.returncode == 0, result.stderr[-400:])
        check('happy publish reports current', 'API_PUBLISH_OK' in result.stdout, result.stdout)
        check('current switched', os.readlink(root / 'current') == f'releases/{OK_ID}')
        fresh = root / 'releases' / OK_ID
        check('old release kept', (root / 'releases' / OLD_ID).is_dir())
        check('dependencies reused', (fresh / 'node_modules/.keep').is_file())
        check('data linked in', (fresh / '.data').is_symlink() and os.readlink(fresh / '.data') == str(data))
        check('secrets linked in', (fresh / '.secrets').is_symlink() and os.readlink(fresh / '.secrets') == str(secrets))
        check('quota backup made', (data / 'backups' / f'auth-before-api-{OK_ID}.sqlite').is_file())
        check('accounts intact', account_count(data / 'auth.sqlite') == 2)
        check('no staging leftovers', not list((root / 'releases').glob('.staging-*')))
        check('no link leftovers', not list(root.glob('.link.*')))

        # 2. The same release id is never overwritten.
        result = publish(OK_ID, archive, manifest)
        check('overwrite refused', result.returncode == 2 and 'refusing overwrite' in result.stderr,
              result.stderr[-300:])

        # 3. Unhealthy new release rolls back to the previous one.
        archive2, manifest2 = pack('broken', lockfile=EMPTY_LOCK)
        result = publish(BROKEN_ID, archive2, manifest2)
        check('failed health exits non-zero', result.returncode != 0)
        check('failure restored old release', 'Publish failed; restoring' in result.stderr, result.stderr[-400:])
        check('rollback reported', 'API_PUBLISH_ROLLED_BACK' in result.stderr, result.stderr[-400:])
        check('current is the good release', os.readlink(root / 'current') == f'releases/{OK_ID}')
        check('failed release left for inspection', (root / 'releases' / BROKEN_ID).is_dir())
        # The changed lockfile must re-install instead of copying the old modules; a
        # failure here would have aborted before the switch and skipped the rollback.
        check('lockfile change re-installs dependencies',
              not (root / 'releases' / BROKEN_ID / 'node_modules' / '.keep').exists())
        check('health recovered', health.read_text() == OK_BODY)

        # 3b. `{"account":null}` plus another line is not the contract: a line
        # match would publish it, the exact-body check must refuse and roll back.
        archive_extra, manifest_extra = pack('extra')
        result = publish(EXTRA_ID, archive_extra, manifest_extra)
        check('extra health line refused', result.returncode != 0 and 'API_PUBLISH_OK' not in result.stdout,
              result.stdout[-300:])
        check('extra health line rolled back', 'API_PUBLISH_ROLLED_BACK' in result.stderr, result.stderr[-400:])
        check('extra release not served', os.readlink(root / 'current') == f'releases/{OK_ID}')
        check('health body rewrote itself', health.read_text() == OK_BODY)

        for label, release_id in [('NUL suffix', '20270108T000000Z'), ('trailing newline', '20270109T000000Z'), ('trailing blank line', '20270110T000000Z')]:
            bad_archive, bad_manifest = pack(label.replace(' ', '-'))
            result = publish(release_id, bad_archive, bad_manifest)
            check(label + ' refused', result.returncode == 1 and 'API_PUBLISH_OK' not in result.stdout, result.stderr[-400:])
            check(label + ' rolled back', 'API_PUBLISH_ROLLED_BACK' in result.stderr)
            check(label + ' not served', os.readlink(root / 'current') == f'releases/{OK_ID}')
            check(label + ' preserved', (root / 'releases' / release_id).is_dir())
            check(label + ' recovered', health.read_bytes() == OK_BODY.encode())

        # 3b. The documented rollback command republishes the older release.
        old_archive, old_manifest = pack('old-tree')
        result = publish(OLD_ID, old_archive, old_manifest, mode='switch')
        check('switch back exits 0', result.returncode == 0, result.stderr[-400:])
        check('switch back moved current', os.readlink(root / 'current') == f'releases/{OLD_ID}')
        result = publish(OK_ID, archive, manifest, mode='switch')
        check('switch forward exits 0', result.returncode == 0, result.stderr[-400:])
        check('switch forward moved current', os.readlink(root / 'current') == f'releases/{OK_ID}')
        # A release whose files no longer match its own manifest must not be served.
        (root / 'releases' / OLD_ID / 'server/ark.mjs').write_text('// tampered\n')
        result = publish(OLD_ID, old_archive, old_manifest, mode='switch')
        check('switch refuses a tampered release', result.returncode != 0 and 'Changed release file' in result.stderr,
              result.stderr[-300:])
        check('switch refusal keeps current', os.readlink(root / 'current') == f'releases/{OK_ID}')

        # 4. A tampered archive is rejected before anything is created.
        archive3, manifest3 = pack('tampered')
        blob = bytearray(archive3.read_bytes())
        blob[len(blob) // 2] ^= 0x01
        archive3.write_bytes(bytes(blob))
        result = publish('20270103T000000Z', archive3, manifest3)
        check('tampered archive rejected', result.returncode != 0 and 'API_PUBLISH_OK' not in result.stdout,
              result.stdout)
        check('tampered archive created nothing', not (root / 'releases' / '20270103T000000Z').exists())
        check('current unchanged after rejection', os.readlink(root / 'current') == f'releases/{OK_ID}')

        # 5. A manifest that grew a secret entry is rejected by the checker.
        manifest4 = tmp / 'secret.json'
        data4 = json.loads(manifest3.read_text())
        data4['.secrets/ark.env'] = hashlib.sha256(b'x').hexdigest()
        manifest4.write_text(json.dumps(data4))
        result = subprocess.run(
            ['python3', str(SCRIPTS / 'release.py'), 'verify-tree', str(root / 'releases' / OK_ID),
             str(manifest4), '--kind', 'api'], capture_output=True, text=True)
        check('secret manifest rejected', result.returncode != 0 and 'Unapproved API path' in result.stderr,
              result.stderr[-300:])

        # 7. A health endpoint that answers with a non-200 status (and no body) is
        # a failure even though the release itself started; the release must roll
        # back to the previous one. The stub service returns 503 once its health
        # file is gone, which the stub restarter does for FAIL_ID.
        fail_archive, fail_manifest = pack('fail')
        result = publish(FAIL_ID, fail_archive, fail_manifest)
        check('non-200 health refused', result.returncode != 0 and 'API health check failed' in result.stderr,
              result.stderr[-300:])
        check('non-200 health rolled back', 'API_PUBLISH_ROLLED_BACK' in result.stderr, result.stderr[-400:])
        check('non-200 release not served', os.readlink(root / 'current') == f'releases/{OK_ID}')
        check('non-200 release left for inspection', (root / 'releases' / FAIL_ID).is_dir())
        check('non-200 health recovered', health.read_text() == OK_BODY)
        health.write_text(OK_BODY)

    print(f'API_REHEARSAL {"OK" if not failures else "FAILED"} failures={failures}')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
