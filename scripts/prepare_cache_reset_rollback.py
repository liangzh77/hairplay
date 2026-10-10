#!/usr/bin/env python3
"""Clone a previously verified H5 release and replace the image SW with an unregistering worker.

Never mutate the historical release. The new directory has its own manifest and can
be atomically selected with the existing release symlink after verification.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import release


def prepare(old_dir, old_manifest, reset_worker, reset_sha, out_dir, out_manifest):
    old_dir, out_dir = Path(old_dir), Path(out_dir)
    previous = release.manifest(old_manifest)
    release.verify_tree(old_dir, previous)
    if 'hairplay-images-sw.js' in previous:
        raise ValueError('Expected an older release without the image worker')
    data = Path(reset_worker).read_bytes()
    if hashlib.sha256(data).hexdigest() != reset_sha or b'self.registration.unregister()' not in data:
        raise ValueError('Unverified worker reset file')
    if out_dir.exists() or Path(out_manifest).exists():
        raise ValueError('Rollback release/manifest already exists')
    shutil.copytree(old_dir, out_dir, symlinks=False)
    (out_dir / 'hairplay-images-sw.js').write_bytes(data)
    (out_dir / 'hairplay-images-sw.js').chmod(0o644)
    expected = {**previous, 'hairplay-images-sw.js': hashlib.sha256(data).hexdigest()}
    release.verify_tree(out_dir, expected)
    Path(out_manifest).write_text(json.dumps(dict(sorted(expected.items())), indent=2) + '\n')
    print(f'ROLLBACK_READY files={len(expected)}')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['old_dir', 'old_manifest', 'reset_worker', 'reset_sha', 'out_dir', 'out_manifest']:
        p.add_argument(name)
    args = p.parse_args()
    prepare(**vars(args))
