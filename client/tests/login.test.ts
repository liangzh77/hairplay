import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loginRequest} from '../src/core/login';

test('empty and invalid fields cannot create an auth request',()=>{
 for(const action of ['code','login'] as const){
  assert.throws(()=>loginRequest(action,'',''),/请先填写邮箱/);
  assert.throws(()=>loginRequest(action,'   ',''),/请先填写邮箱/);
  for(const email of ['not-an-email','a@b','a b@example.invalid','a'.repeat(255)+'@example.invalid'])assert.throws(()=>loginRequest(action,email,'123456'),/有效的邮箱/);
 }
 assert.throws(()=>loginRequest('login','qa@example.invalid',''),/请输入邮件里的6位/);
 for(const code of ['12345','1234567','abcdef','１２３４５６','123 56'])assert.throws(()=>loginRequest('login','qa@example.invalid',code),/6位数字/);
});
test('payload is normalized and contains only the fields needed for the action',()=>{
 assert.deepEqual(loginRequest('code',' QA@Example.invalid ','stale'),{email:'qa@example.invalid'});
 assert.deepEqual(loginRequest('login',' QA@Example.invalid ','012345'),{email:'qa@example.invalid',code:'012345'});
 assert.deepEqual(loginRequest('logout','',''),{});
});
test('login UI keeps field semantics, steps and removes internal-policy paragraphs',()=>{
 const ui=readFileSync(new URL('../src/pages/index/index.vue',import.meta.url),'utf8');
 assert.match(ui,/首次登录自动注册/);
 assert.match(ui,/autocomplete="email" inputmode="email"/);
 assert.match(ui,/autocomplete="one-time-code" inputmode="numeric"/);
 assert.match(ui,/body=loginRequest\(action,shownEmail,shownCode\)/);
 assert.match(ui,/visibleAuthValue\('auth-email',email.value\)/);
 assert.doesNotMatch(ui,/最多注册100个已验证邮箱|邮箱用于验证码登录和额度管理|最多 100 位验证用户/);
});
