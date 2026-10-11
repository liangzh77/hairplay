#!/usr/bin/env python3
import io
import json
import os
from pathlib import Path
import shutil
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


class ApiReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tree = self.root / 'api'
        (self.tree / 'server').mkdir(parents=True)
        (self.tree / 'client/src/core').mkdir(parents=True)
        (self.tree / 'package.json').write_text('{"name":"hairplay-api"}')
        (self.tree / 'package-lock.json').write_text('{"lockfileVersion":3}')
        for name in ['ark.mjs', 'auth.mjs', 'mail.mjs']:
            (self.tree / 'server' / name).write_text(f'// {name}')
        (self.tree / 'client/src/core/catalog.json').write_text('[]')

    def test_pack_api_round_trip_and_manifest_kind(self):
        archive, manifest = self.root / 'api.tgz', self.root / 'api-manifest.json'
        release.pack_api(self.tree, archive, manifest)
        expected = release.manifest(manifest, 'api')
        self.assertIn('server/ark.mjs', expected)
        self.assertNotIn('index.html', expected)
        release.verify_archive(archive, expected)
        release.verify_tree(self.tree, expected)
        # An API manifest is not a valid H5 manifest and vice versa.
        with self.assertRaises(ValueError):
            release.manifest(manifest, 'static')
        with self.assertRaises(ValueError):
            release.manifest(manifest, 'nonsense')

    def test_pack_api_rejects_dependencies_secrets_and_state(self):
        for name in ['node_modules/sharp/index.js', '.secrets/ark.env', '.data/auth.sqlite',
                     'server/backup.sqlite', '.env', 'server/ark.mjs.bak']:
            with self.subTest(name=name):
                path = self.tree / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'x')
                with self.assertRaises(ValueError):
                    release.pack_api(self.tree, self.root / 'bad-api.tgz', self.root / 'bad-api.json')
                self.assertFalse((self.root / 'bad-api.tgz').exists())
                path.unlink()
                if name.startswith(('.secrets/', '.data/')):
                    path.parent.rmdir()

    def test_pack_api_requires_the_whole_backend(self):
        (self.tree / 'server/auth.mjs').unlink()
        with self.assertRaisesRegex(ValueError, 'Unexpected directory|Incomplete API tree'):
            release.pack_api(self.tree, self.root / 'missing.tgz', self.root / 'missing.json')
        self.assertFalse((self.root / 'missing.tgz').exists())

    def test_api_manifest_rejects_secret_entries(self):
        manifest = self.root / 'api-manifest.json'
        release.pack_api(self.tree, self.root / 'api.tgz', manifest)
        data = json.loads(manifest.read_text())
        data['.secrets/ark.env'] = '0' * 64
        manifest.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'Secret/state file prohibited'):
            release.manifest(manifest, 'api')
    def test_verify_api_release_accepts_runtime_entries_only(self):
        manifest = self.root / 'api-manifest.json'
        release.pack_api(self.tree, self.root / 'api.tgz', manifest)
        expected = release.manifest(manifest, 'api')
        deployed = self.root / 'deployed'
        shutil.copytree(self.tree, deployed)
        (deployed / 'node_modules/sub').mkdir(parents=True)
        (deployed / 'node_modules/sub/index.js').write_text('dep')
        (deployed / '.data').symlink_to(self.root)
        (deployed / '.secrets').symlink_to(self.root)
        release.verify_api_tree(deployed, expected)
        # Dependencies must be a real directory; the two links must be links.
        (deployed / 'node_modules').rename(self.root / 'moved-node-modules')
        (deployed / 'node_modules').symlink_to(self.root / 'moved-node-modules')
        with self.assertRaisesRegex(ValueError, 'node_modules must be a real directory'):
            release.verify_api_tree(deployed, expected)
        (deployed / 'node_modules').unlink()
        (self.root / 'moved-node-modules').rename(deployed / 'node_modules')
        (deployed / '.data').unlink()
        (deployed / '.data').mkdir()
        with self.assertRaisesRegex(ValueError, r'\.data must be a symlink'):
            release.verify_api_tree(deployed, expected)
        (deployed / '.data').rmdir()
        (deployed / '.data').symlink_to(self.root)
        # Extra files, changed files and missing files are all rejected.
        cases = [('server/stray.mjs', 'extra'), ('backup.sqlite', 'extra'), ('client/src/core/stray.json', 'extra'),
                 ('server/ark.mjs', 'changed'), ('client/src/core/catalog.json', 'changed'),
                 ('server/mail.mjs', 'missing'), ('package-lock.json', 'missing')]
        for name, mutate in cases:
            with self.subTest(name=name, mutate=mutate):
                path = deployed / name
                original = path.read_bytes() if path.exists() else None
                if mutate == 'extra':
                    path.write_text('x')
                elif mutate == 'changed':
                    path.write_text('// changed')
                else:
                    path.unlink()
                with self.assertRaises(ValueError):
                    release.verify_api_tree(deployed, expected)
                if mutate == 'extra':
                    path.unlink()
                else:
                    path.write_bytes(original)


if __name__ == '__main__':
    unittest.main()
