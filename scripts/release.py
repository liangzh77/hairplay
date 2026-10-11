#!/usr/bin/env python3
"""Fail-closed release manifest, USTAR packaging, archive/tree and HTTP checks."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import tarfile
import urllib.request
import urllib.error


def digest(data):
    if data.startswith(b'\x00\x05\x16\x07'):
        raise ValueError('AppleDouble payload prohibited')
    return hashlib.sha256(data).hexdigest()


# The API release is the backend tree only: no build output, no dependencies and
# no secrets. node_modules is installed server-side from the locked manifest.
# The allowlist is the exact shape the server runs on: the four backend modules
# (ark, auth, auth-worker, mail), the catalogue index and the catalogue pictures.
# Anything else that happens to be committed -- a test file, the client sources,
# an icon, a `.bin` -- is refused instead of shipped, so the deployed tree is a
# contract and not a snapshot.
API_REQUIRED = ('package.json', 'package-lock.json', 'server/ark.mjs', 'server/auth.mjs', 'server/mail.mjs')
API_ALLOWED = re.compile(r'^(?:server/(?:ark|auth|auth-worker|mail)\.mjs|client/src/core/catalog\.json|client/src/static/catalog/[A-Za-z0-9_.-]+\.jpg|package\.json|package-lock\.json)$')
# Dependencies and state are installed/linked on the server, so a release may
# never carry them. The check is by name at every depth: a nested node_modules or
# a backup of the database is exactly as forbidden as a top-level one, and it is
# enforced for manifests and packed archives alike, because a manifest is the
# contract the deployed tree is verified against.
API_FORBIDDEN_COMPONENT = ('node_modules', '.git', '.data', '.secrets', '.venv', '__MACOSX')
API_FORBIDDEN_EXT = re.compile(r'\.(?:sqlite|sqlite-wal|sqlite-shm|sqlite3|db|bak|backup|env|log|pem|key|crt|p12|pfx|swp|swo|orig|rej|tgz|tar|zip)$')


def api_name_ok(name):
    if not API_ALLOWED.fullmatch(name):
        return False
    parts = PurePosixPath(name).parts
    if any(part in API_FORBIDDEN_COMPONENT or part.startswith('.') for part in parts):
        return False
    return not API_FORBIDDEN_EXT.search(name)


def safe_name(name):
    parts = PurePosixPath(name).parts
    if (not parts or name != '/'.join(parts) or name.startswith('/') or
            any(p in ('.', '..', '__MACOSX', '.DS_Store') or p.startswith('._') for p in parts) or
            not re.fullmatch(r'[A-Za-z0-9_./-]+', name)):
        raise ValueError(f'Unsafe/metadata path: {name}')
    return name


def manifest(path, kind='static'):
    data = json.loads(Path(path).read_text())
    if not isinstance(data, dict) or not data:
        raise ValueError('Invalid manifest')
    if kind == 'static':
        if 'index.html' not in data:
            raise ValueError('Invalid manifest')
    elif kind == 'api':
        missing = [name for name in API_REQUIRED if name not in data]
        if missing:
            raise ValueError(f'Invalid API manifest, missing {missing}')
    else:
        raise ValueError(f'Unknown kind: {kind}')
    for name, sha in data.items():
        safe_name(name)
        # The same rules as the packer: a manifest that describes a tree the packer
        # would never produce must be refused, not trusted.
        if kind == 'api' and not api_name_ok(name):
            raise ValueError(f'Unapproved API path: {name}')
        if not isinstance(sha, str) or not re.fullmatch(r'[0-9a-f]{64}', sha):
            raise ValueError(f'Invalid hash: {name}')
    return data


def directories(expected):
    return {str(p) for name in expected for p in PurePosixPath(name).parents if str(p) != '.'}


def tree(root):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Build/release must be a real directory')
    files, dirs = {}, set()
    for base, subdirs, names in os.walk(root, followlinks=False):
        for name in subdirs + names:
            p = Path(base) / name
            rel = safe_name(p.relative_to(root).as_posix())
            if p.is_symlink():
                raise ValueError(f'Symlink prohibited: {rel}')
            if p.is_dir():
                dirs.add(rel)
            elif p.is_file():
                files[rel] = digest(p.read_bytes())
            else:
                raise ValueError(f'Special file prohibited: {rel}')
    return files, dirs


def verify_tree(root, expected):
    files, dirs = tree(root)
    if files != expected or dirs != directories(expected):
        raise ValueError(f'Tree differs: extra={sorted(files.keys()-expected.keys())}, '
                         f'missing={sorted(expected.keys()-files.keys())}, '
                         f'changed={sorted(n for n in files.keys() & expected.keys() if files[n] != expected[n])}, '
                         f'unexpected_dirs={sorted(dirs-directories(expected))}')


# Runtime entries a deployed API release has on top of its manifest: installed
# dependencies and the two links to the persistent database and the secrets.
API_RUNTIME = ('node_modules', '.data', '.secrets')


def verify_api_tree(root, expected):
    """Verify a deployed API release: every manifest file byte-identical, the
    runtime entries present in the expected shape and nothing else."""
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Release must be a real directory')
    dirs = directories(expected)
    # Every directory the manifest describes must be a real directory inside the
    # release: a symlinked parent would let the deployed code live outside the
    # version tree, where a later edit would silently change what runs.
    for name in sorted(dirs):
        path = root / name
        if path.is_symlink() or not path.is_dir():
            raise ValueError(f'Symlinked/missing release directory: {name}')
    for name, sha in expected.items():
        path = root / name
        if path.is_symlink() or not path.is_file():
            raise ValueError(f'Missing or unsafe release file: {name}')
        if digest(path.read_bytes()) != sha:
            raise ValueError(f'Changed release file: {name}')
    for base in ['.'] + sorted(dirs):
        # iterdir() yields base names, so compare names and not relative paths.
        allowed = {PurePosixPath(n).name for n in expected if str(PurePosixPath(n).parent) == base}
        allowed |= {PurePosixPath(d).name for d in dirs if str(PurePosixPath(d).parent) == base}
        if base == '.':
            allowed |= set(API_RUNTIME)
        for entry in sorted(p.name for p in (root / base).iterdir()):
            if entry not in allowed:
                raise ValueError(f'Unexpected release entry: {base}/{entry}')
        if base == '.':
            for name in API_RUNTIME:
                path = root / name
                if name == 'node_modules':
                    if path.is_symlink() or not path.is_dir():
                        raise ValueError('node_modules must be a real directory')
                elif not path.is_symlink():
                    raise ValueError(f'{name} must be a symlink')


def verify_archive(path, expected):
    seen, dirs = {}, set()
    with tarfile.open(path, 'r:gz') as archive:
        for member in archive:
            name = safe_name(member.name)
            if name in seen or name in dirs or member.pax_headers:
                raise ValueError(f'Duplicate/extended archive entry: {name}')
            if member.isdir() and name in directories(expected):
                dirs.add(name)
            elif member.isreg() and name in expected:
                if member.size > 64 * 1024 * 1024:
                    raise ValueError(f'Oversized member: {name}')
                seen[name] = digest(archive.extractfile(member).read())
            else:
                raise ValueError(f'Unapproved archive entry/type: {name}')
    if seen != expected:
        raise ValueError('Archive file set/hashes differ from manifest')


def expected_image_worker(approved):
    # Recompute the cache revision independently of the JS build checker.
    images = sorted((name, sha) for name, sha in approved.items()
                    if re.fullmatch(r'static/(?:catalog|icons)/.+', name))
    revision = hashlib.sha256(json.dumps(images, separators=(',', ':')).encode()).hexdigest()[:16]
    source = (Path(__file__).resolve().parents[1] /
              'client/scripts/hairplay-images-sw.js').read_text()
    if source.count('__IMAGE_CACHE_REVISION__') != 1 or source.count('__IMAGE_ASSET_HASHES__') != 1:
        raise ValueError('Invalid public image worker template')
    hashes = {name[len('static/'):]: sha[:16] for name, sha in images}
    return source.replace('__IMAGE_CACHE_REVISION__', revision).replace(
        '__IMAGE_ASSET_HASHES__', json.dumps(hashes, separators=(',', ':'))).encode()


def pack(root, archive, output_manifest):
    # Independent strict file whitelist, in addition to the build checker.
    approved = json.loads((Path(__file__).resolve().parents[1] /
                          'client/scripts/public-assets.json').read_text())
    files, dirs = tree(root)
    worker_hash = digest(expected_image_worker(approved))
    for name, sha in files.items():
        if name.startswith('static/'):
            if approved.get(name) != sha:
                raise ValueError(f'Unapproved static asset: {name}')
        elif name == 'hairplay-images-sw.js':
            if sha != worker_hash:
                raise ValueError('Unapproved public image worker')
        elif name != 'index.html' and not re.fullmatch(r'assets/[A-Za-z0-9_.-]+\.(js|css|svg)', name):
            raise ValueError(f'Unapproved build file: {name}')
    if not approved.keys() <= files.keys() or 'index.html' not in files or files.get('hairplay-images-sw.js') != worker_hash or dirs != directories(files):
        raise ValueError('Incomplete build or unexpected directory')
    # Exclusive creation: never overwrite a previous package or manifest.
    with open(output_manifest, 'x') as f:
        json.dump(dict(sorted(files.items())), f, indent=2)
        f.write('\n')
    # Python USTAR does not consult macOS xattrs/resource forks; no tar subprocess.
    with open(archive, 'xb') as out, tarfile.open(fileobj=out, mode='w:gz', format=tarfile.USTAR_FORMAT) as tar:
        for name in sorted(files):
            data = (Path(root) / name).read_bytes()
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode, entry.mtime = len(data), 0o644, 0
            tar.addfile(entry, io.BytesIO(data))
    # Any error is fatal; an unverified package must never be uploaded.
    verify_archive(archive, files)
    verify_tree(root, files)
    print(f'PACK_OK files={len(files)} archive={archive}')


def pack_api(root, archive, output_manifest):
    # Same exclusive-write, USTAR, verify-after-write discipline as the H5 pack.
    files, dirs = tree(root)
    if not set(API_REQUIRED) <= files.keys() or dirs != directories(files):
        raise ValueError('Incomplete API tree or unexpected directory')
    for name in files:
        if not api_name_ok(name):
            raise ValueError(f'Unapproved API file: {name}')
    with open(output_manifest, 'x') as f:
        json.dump(dict(sorted(files.items())), f, indent=2)
        f.write('\n')
    with open(archive, 'xb') as out, tarfile.open(fileobj=out, mode='w:gz', format=tarfile.USTAR_FORMAT) as tar:
        for name in sorted(files):
            data = (Path(root) / name).read_bytes()
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode, entry.mtime = len(data), 0o644, 0
            tar.addfile(entry, io.BytesIO(data))
    verify_archive(archive, files)
    verify_tree(root, files)
    print(f'PACK_API_OK files={len(files)} archive={archive}')


def verify_http(base, expected):
    base = base.rstrip('/') + '/'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for name, sha in sorted(expected.items()):
        with opener.open(base + name, timeout=30) as response:
            if response.status != 200 or response.url != base + name or digest(response.read()) != sha:
                raise ValueError(f'HTTP file/hash mismatch: {name}')
    probes = {'__MACOSX/._index.html', '.DS_Store'}
    for name in set(expected) | directories(expected):
        p = PurePosixPath(name)
        probes.add(str(p.with_name('._' + p.name)))
    for name in sorted(probes):
        try:
            with opener.open(base + name, timeout=30) as response:
                raise ValueError(f'Metadata exposed: {name} HTTP {response.status}')
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise ValueError(f'Expected 404: {name} HTTP {error.code}') from error
    print(f'HTTP_OK files={len(expected)} SHA-256 matches; metadata_404={len(probes)}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['pack', 'pack-api', 'verify-archive', 'verify-tree',
                                           'verify-api-release', 'verify-http'])
    parser.add_argument('source')
    parser.add_argument('manifest')
    parser.add_argument('--archive')
    parser.add_argument('--kind', choices=['static', 'api'], default='static')
    args = parser.parse_args()
    if args.action == 'pack':
        if not args.archive:
            parser.error('pack requires --archive')
        pack(args.source, args.archive, args.manifest)
    elif args.action == 'pack-api':
        if not args.archive:
            parser.error('pack-api requires --archive')
        pack_api(args.source, args.archive, args.manifest)
    else:
        # A deployed API release is verified against an API manifest, always.
        kind = 'api' if args.action == 'verify-api-release' else args.kind
        expected = manifest(args.manifest, kind)
        if args.action == 'verify-archive':
            verify_archive(args.source, expected)
        elif args.action == 'verify-tree':
            verify_tree(args.source, expected)
        elif args.action == 'verify-api-release':
            verify_api_tree(args.source, expected)
        else:
            verify_http(args.source, expected)
        if args.action != 'verify-http':
            print(f'{args.action.upper().replace("-", "_")}_OK files={len(expected)}')


if __name__ == '__main__':
    main()
