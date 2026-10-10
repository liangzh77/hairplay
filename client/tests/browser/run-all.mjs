// Run the browser harnesses one after another and print a single summary.
//
//   node client/tests/browser/run-all.mjs             # offline harnesses
//   node client/tests/browser/run-all.mjs --live      # the deployed site
//   node client/tests/browser/run-all.mjs gallery-lock.mjs
//
// Each harness drives a real Chrome; the offline ones need
// `npm --workspace client run build:public` first and never touch the network
// (they serve the built bundle from an ephemeral port). The live ones and the
// public smoke test require network access to the deployed site.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const offline = ['gallery-browser.mjs', 'gallery-lock.mjs', 'gallery-layout.mjs', 'image-cache-browser.mjs'];
const live = ['live-verify.mjs', 'live-failclosed.mjs', 'live-normal-delete.mjs', 'public-features-smoke.mjs'];

const args = process.argv.slice(2);
const named = args.filter(arg => !arg.startsWith('--'));
const scripts = named.length ? named : args.includes('--live') ? live : offline;

const run = file => new Promise((resolveRun, rejectRun) => {
  const child = spawn(process.execPath, [resolve(here, file)], {stdio: 'inherit'});
  child.on('error', rejectRun);
  child.on('close', code => resolveRun(code ?? 1));
});

const failed = [];
for (const file of scripts) {
  if (!existsSync(resolve(here, file))) {
    console.error(`unknown harness: ${file}`);
    process.exit(2);
  }
  const started = Date.now();
  const code = await run(file);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`-- ${code === 0 ? 'PASS' : 'FAIL'} ${file} (${seconds}s)`);
  if (code !== 0) failed.push(file);
}

console.log(`BROWSER_HARNESS ${failed.length ? 'FAIL' : 'OK'} ${scripts.length - failed.length}/${scripts.length}` + (failed.length ? ` failed=${failed.join(',')}` : ''));
process.exit(failed.length ? 1 : 0);
