import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalog,decodeState,initialState,insertFavorite,settleLocalFavorites} from '../src/core/model';
const a=catalog[0],b=catalog[1];
test('legacy mixed favorites retain local-only ids; account cache is a separate namespace',()=>{
 const local=insertFavorite(insertFavorite([],a),b);
 const legacy=decodeState({version:1,favorites:local});assert.equal(legacy.favoritesSeparated,false);
 const migrated=settleLocalFavorites(legacy,[a.id],[],true);assert.deepEqual(migrated.favorites.map(f=>f.styleId),[b.id]);
 const state={...migrated,accountFavorites:{owner:'a@example.invalid',items:[local[1]]}};
 assert.deepEqual(decodeState(JSON.stringify(state)),state);
 assert.deepEqual(state.favorites.map(f=>f.styleId),[b.id]);
});
test('successful adoption consumes only captured items, conflict never consumes any',()=>{
 const old={...initialState(),favorites:insertFavorite([],a)};
 const concurrent={...old,favorites:insertFavorite(old.favorites,b)};
 assert.deepEqual(settleLocalFavorites(concurrent,[a.id],[a.id],false).favorites.map(f=>f.styleId),[b.id]);
 assert.deepEqual(settleLocalFavorites(concurrent,[b.id],[],false).favorites,concurrent.favorites);
 // An explicitly local item must not disappear just because the account also has it.
 assert.deepEqual(settleLocalFavorites(old,[a.id],[],true).favorites,old.favorites);
});
