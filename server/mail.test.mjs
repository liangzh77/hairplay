import {test} from 'node:test';
import {randomInt} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import nodemailer from 'nodemailer';
import {loadMailer} from './mail.mjs';
test('mail configuration rejects missing/insecure/partial data; fake transport uses checked TLS and timeouts',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'hairplay-mail-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'mail.env');
 await assert.rejects(loadMailer(path));writeFileSync(path,'SMTP_HOST=smtp.example.invalid\n',{mode:0o600});await assert.rejects(loadMailer(path));
 const conf='SMTP_HOST=smtp.example.invalid\nSMTP_PORT=465\nSMTP_USER=sender@example.invalid\nSMTP_PASS=fake-test-only\nSMTP_FROM=sender@example.invalid\n';
 writeFileSync(path,conf);chmodSync(path,0o644);await assert.rejects(loadMailer(path));chmodSync(path,0o600);
 writeFileSync(path,conf.replace('465','587'));await assert.rejects(loadMailer(path));writeFileSync(path,conf);
 const original=nodemailer.createTransport;let captured,sends=0;nodemailer.createTransport=opts=>{captured=opts;return {sendMail:async()=>{sends++;return {accepted:['fake']};},close:()=>{}};};t.after(()=>nodemailer.createTransport=original);
 const mailer=await loadMailer(path);assert.equal(captured.port,465);assert.equal(captured.secure,true);assert.equal(captured.tls.rejectUnauthorized,true);assert.equal(captured.tls.minVersion,'TLSv1.2');assert.equal(captured.logger,false);assert.equal(captured.debug,false);assert.ok(captured.connectionTimeout<=10000&&captured.socketTimeout<=20000);await mailer.send('recipient@example.invalid',String(randomInt(0,1000000)).padStart(6,'0'));assert.equal(sends,1);mailer.close();
});
