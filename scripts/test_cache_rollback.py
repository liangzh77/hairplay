import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import release
from prepare_cache_reset_rollback import prepare


class CacheRollbackTests(unittest.TestCase):
    def test_clones_verified_old_release_and_installs_cleanup_worker(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);old=root/'old';old.mkdir();(old/'index.html').write_text('old page')
            original=release.digest(b'old page');manifest=root/'old.json';manifest.write_text(json.dumps({'index.html':original}))
            worker=Path(__file__).resolve().parents[1]/'client/scripts/hairplay-images-sw-reset.js'
            digest=hashlib.sha256(worker.read_bytes()).hexdigest()
            out=root/'rollback';result=root/'rollback.json'
            prepare(old,manifest,worker,digest,out,result)
            release.verify_tree(out,release.manifest(result))
            self.assertFalse((old/'hairplay-images-sw.js').exists())
            self.assertIn(b'self.registration.unregister()', (out/'hairplay-images-sw.js').read_bytes())
            with self.assertRaises(ValueError):
                prepare(old,manifest,worker,'0'*64,root/'bad',root/'bad.json')
            (old/'index.html').write_text('tampered')
            with self.assertRaises(ValueError):
                prepare(old,manifest,worker,digest,root/'tampered',root/'tampered.json')


if __name__=='__main__':unittest.main()
