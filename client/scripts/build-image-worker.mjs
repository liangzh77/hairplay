import {writeFile} from 'node:fs/promises';
import {imageWorkerCode} from './image-worker-code.mjs';
await writeFile(new URL('../dist/build/h5/hairplay-images-sw.js',import.meta.url),await imageWorkerCode());
console.log('Public-only image service worker added to H5 build');
