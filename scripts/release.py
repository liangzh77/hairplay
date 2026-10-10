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


def safe_name(name):
    parts = PurePosixPath(name).parts
    if (not parts or name != '/'.join(parts) or name.startswith('/') or
            any(p in ('.', '..', '__MACOSX', '.DS_Store') or p.startswith('._') for p in parts) or
            not re.fullmatch(r'[A-Za-z0-9_./-]+', name)):
        raise ValueError(f'Unsafe/metadata path: {name}')
    return name


def manifest(path):
    data = json.loads(Path(path).read_text())
    if not isinstance(data, dict) or not data or 'index.html' not in data:
        raise ValueError('Invalid manifest')
    for name, sha in data.items():
        safe_name(name)
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
    parser.add_argument('action', choices=['pack', 'verify-archive', 'verify-tree', 'verify-http'])
    parser.add_argument('source')
    parser.add_argument('manifest')
    parser.add_argument('--archive')
    args = parser.parse_args()
    if args.action == 'pack':
        if not args.archive:
            parser.error('pack requires --archive')
        pack(args.source, args.archive, args.manifest)
    else:
        expected = manifest(args.manifest)
        if args.action == 'verify-archive':
            verify_archive(args.source, expected)
        elif args.action == 'verify-tree':
            verify_tree(args.source, expected)
        else:
            verify_http(args.source, expected)
        if args.action != 'verify-http':
            print(f'{args.action.upper().replace("-", "_")}_OK files={len(expected)}')


if __name__ == '__main__':
    main()
