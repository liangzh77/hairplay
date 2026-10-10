#!/usr/bin/env python3
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
import release


class ReleaseSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.build = self.root / 'h5'
        self.build.mkdir()
        (self.build / 'index.html').write_bytes(b'hello')
        self.expected = {'index.html': release.digest(b'hello')}

    def archive(self, entries, fmt=tarfile.USTAR_FORMAT):
        path = self.root / 'test.tgz'
        with tarfile.open(path, 'w:gz', format=fmt) as tar:
            for name, data, kind in entries:
                entry = tarfile.TarInfo(name)
                entry.type = kind
                if kind == tarfile.REGTYPE:
                    entry.size = len(data)
                    tar.addfile(entry, io.BytesIO(data))
                else:
                    entry.linkname = 'index.html'
                    tar.addfile(entry)
        return path

    def test_valid_archive_and_tree(self):
        release.verify_tree(self.build, self.expected)
        release.verify_archive(self.archive([('index.html', b'hello', tarfile.REGTYPE)]), self.expected)

    def test_metadata_paths_rejected_in_tree_and_archive(self):
        for name in ['._index.html', 'assets/._app.js', '__MACOSX/._index.html', '.DS_Store']:
            with self.subTest(name=name):
                file = self.build / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(b'bad')
                with self.assertRaises(ValueError):
                    release.verify_tree(self.build, self.expected)
                file.unlink()
                with self.assertRaises(ValueError):
                    release.verify_archive(self.archive([
                        ('index.html', b'hello', tarfile.REGTYPE), (name, b'bad', tarfile.REGTYPE)
                    ]), self.expected)

    def test_archive_traversal_links_duplicates_extra_and_hashes(self):
        cases = [
            [('../index.html', b'hello', tarfile.REGTYPE)],
            [('/index.html', b'hello', tarfile.REGTYPE)],
            [('index.html', b'', tarfile.SYMTYPE)],
            [('index.html', b'', tarfile.LNKTYPE)],
            [('index.html', b'', tarfile.FIFOTYPE)],
            [('index.html', b'hello', tarfile.REGTYPE)] * 2,
            [('index.html', b'changed', tarfile.REGTYPE)],
            [('unexpected.js', b'x', tarfile.REGTYPE)],
            [('._metadata', b'', tarfile.DIRTYPE)],
            [],
        ]
        for entries in cases:
            with self.subTest(entries=entries), self.assertRaises(ValueError):
                release.verify_archive(self.archive(entries), self.expected)

    def test_appledouble_payload_even_with_allowed_name(self):
        data = b'\x00\x05\x16\x07' + b'\0' * 30
        (self.build / 'index.html').write_bytes(data)
        with self.assertRaises(ValueError):
            release.verify_tree(self.build, self.expected)
        with self.assertRaises(ValueError):
            release.verify_archive(self.archive([('index.html', data, tarfile.REGTYPE)]), self.expected)

    def test_tree_symlink_and_extra_directory_rejected(self):
        (self.build / 'link').symlink_to('index.html')
        with self.assertRaises(ValueError):
            release.verify_tree(self.build, self.expected)
        (self.build / 'link').unlink()
        (self.build / 'unused').mkdir()
        with self.assertRaises(ValueError):
            release.verify_tree(self.build, self.expected)

    def test_pack_ustar_ignores_xattrs_and_matches_manifest(self):
        # Use the actual SHA-256 approved public assets, not study material.
        repo = Path(__file__).resolve().parents[1]
        import json
        approved = json.loads((repo / 'client/scripts/public-assets.json').read_text())
        for name in approved:
            dest = self.build / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes((repo / 'client/src' / name).read_bytes())
        (self.build / 'hairplay-images-sw.js').write_bytes(release.expected_image_worker(approved))
        if hasattr(os, 'setxattr'):
            try:
                os.setxattr(self.build / 'index.html', 'com.apple.FinderInfo' if os.uname().sysname == 'Darwin'
                            else 'user.test', b'\0' * 32)
            except OSError:
                pass
        archive, manifest = self.root / 'clean.tgz', self.root / 'manifest.json'
        release.pack(self.build, archive, manifest)
        expected = release.manifest(manifest)
        release.verify_archive(archive, expected)
        with tarfile.open(archive) as tar:
            self.assertEqual(set(tar.getnames()), set(expected))
            self.assertTrue(all(m.isreg() and not m.pax_headers for m in tar))
        worker = self.build / 'hairplay-images-sw.js'
        worker.write_bytes(worker.read_bytes() + b'\n// unauthorized')
        with self.assertRaisesRegex(ValueError, 'Unapproved public image worker'):
            release.pack(self.build, self.root / 'bad-worker.tgz', self.root / 'bad-worker.json')
        self.assertFalse((self.root / 'bad-worker.tgz').exists())
        (self.build / '._index.html').write_bytes(b'bad')
        with self.assertRaises(ValueError):
            release.pack(self.build, self.root / 'bad.tgz', self.root / 'bad.json')
        self.assertFalse((self.root / 'bad.tgz').exists())

    def test_build_checker_rejects_metadata(self):
        repo = Path(__file__).resolve().parents[1]
        (self.build / '._index.html').write_bytes(b'bad')
        result = subprocess.run(['node', str(repo / 'client/scripts/check-public-build.mjs'), str(self.build)],
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Metadata prohibited', result.stderr)
        self.assertFalse(self.build.exists())


if __name__ == '__main__':
    unittest.main()
