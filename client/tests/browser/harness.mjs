// Shared helpers for the browser regression harnesses.
//
// These scripts drive a *real* Chrome against the built H5 bundle (or against
// the deployed site) because the behaviour they cover only exists in a browser:
// cross-tab Web Locks, the Service Worker image cache, `img.decode()` on a
// generated picture, the file picker, real downloads and real `<image>` layout.
//
// Prepare and run from the repository root:
//
//   npm --workspace client run build:public   # build the bundle under test
//   npm run test:browser                      # offline harnesses
//   npm run test:browser:live                 # the deployed site (needs network)
//
// Chrome is located in this order: $HAIRPLAY_CHROME, $CHROME_PATH, the usual
// macOS / Linux / Windows install paths, then Playwright's `channel: 'chrome'`.
// Set HAIRPLAY_HEADED=1 to watch a run.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

export {assert, chromium};

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const h5Dir = resolve(repoRoot, 'client/dist/build/h5');
export const approvedAssets = JSON.parse(readFileSync(resolve(repoRoot, 'client/scripts/public-assets.json'), 'utf8'));

export const GENERATIONS_KEY = 'hairplay.generations.v1';
export const STATE_KEY = 'hairai.study.v1';

/** Absolute path inside the repository. */
export const repoPath = (...parts) => resolve(repoRoot, ...parts);
/** Read a file inside the repository. */
export const readRepo = (...parts) => readFile(repoPath(...parts));
/** A tracked catalog picture as a data URL (never an unlicensed crop). */export const jpegDataUrl = async (name = 'ai-catalog-44-0.jpg') =>
  'data:image/jpeg;base64,' + (await readRepo('client/src/static/catalog', name)).toString('base64');

/** The deployed site, overridable with HAIRPLAY_BASE for a preview deploy. */
export const liveBase = () => process.env.HAIRPLAY_BASE || 'https://liangz77.cn/hairplay/';

export const readGenerations = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), GENERATIONS_KEY);
export const readRecords = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}').records || [], STATE_KEY);

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
  process.env['PROGRAMFILES(X86)'] && `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
].filter(Boolean);

/** Path to a Chrome/Chromium binary, or undefined to let Playwright find one. */
export function chromePath() {
  const explicit = process.env.HAIRPLAY_CHROME || process.env.CHROME_PATH;
  if (explicit) {
    assert.ok(existsSync(explicit), `$HAIRPLAY_CHROME does not exist: ${explicit}`);
    return explicit;
  }
  return CHROME_CANDIDATES.find(candidate => existsSync(candidate));
}

export async function launchBrowser(options = {}) {
  const common = {headless: process.env.HAIRPLAY_HEADED !== '1', ...options};
  const executablePath = chromePath();
  if (executablePath) return chromium.launch({executablePath, ...common});
  try {
    return await chromium.launch({channel: 'chrome', ...common});
  } catch (error) {
    throw new Error(
      'Could not find a Chrome/Chromium binary. Install Google Chrome or point HAIRPLAY_CHROME at one.\n' +
        `Playwright said: ${error.message}`,
    );
  }
}

/** Fail with a useful message when the bundle under test was never built. */
export async function requireBuild() {
  if (!existsSync(resolve(h5Dir, 'index.html'))) {
    throw new Error(`No H5 build in ${h5Dir}. Run: npm --workspace client run build:public`);
  }
}

/**
 * Serve the built H5 bundle on an ephemeral port.
 *
 * `handler(req, res, url)` runs first and may answer API routes: return a truthy
 * value once the response is sent. `dir` defaults to the built bundle so the
 * harnesses exercise exactly what is deployed.
 */
export async function startStatic({dir = h5Dir, base = '/hairplay/', handler} = {}) {
  await requireBuild();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (handler && (await handler(req, res, url))) return;
      const path = url.pathname;
      if (!path.startsWith(base)) return res.writeHead(404).end();
      const file = resolve(dir, path.slice(base.length) + (path.endsWith('/') ? 'index.html' : ''));
      if (file !== dir && !file.startsWith(dir + sep)) return res.writeHead(403).end();
      res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] || 'application/octet-stream');
      res.end(await readFile(file));
    } catch {
      if (!res.headersSent) res.writeHead(404).end();
      else res.end();
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    origin,
    base,
    url: origin + base,
    close: callback => new Promise(done => server.close(() => { if (callback) callback(); done(); })),
  };
}
