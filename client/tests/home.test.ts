import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('home defaults to all styles with the gender-specific hero',()=>{
 const page=readFileSync(new URL('../src/pages/index/index.vue',import.meta.url),'utf8');
 assert.match(page,/const category=ref\('所有风格'\)/);
 assert.match(page,/v-if="category==='所有风格'&&!query" class="hero"/);
 assert.match(page,/@click="openStyle\(heroStyle\)"/);
});
