// At most one real self-addressed message across runs. Claim is durable BEFORE network.
import {open,mkdir} from 'node:fs/promises';
import {randomInt} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {loadMailer} from '../server/mail.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let marker,mailer;
try{
 await mkdir(resolve(root,'.secrets'),{recursive:true,mode:0o700});
 try{marker=await open(resolve(root,'.secrets/smtp-self-check.marker'),'wx',0o600);}catch(e){if(e.code==='EEXIST'){console.log('SELF_SMTP_SKIPPED persistent claim already exists; no retry.');process.exit(0);}throw e;}
 await marker.writeFile('claimed-before-network\n');await marker.sync();
 const directory=await open(resolve(root,'.secrets'),'r');await directory.sync();await directory.close();
 mailer=await loadMailer(resolve(root,'.secrets/mail.env'));
 await mailer.send(mailer.self,String(randomInt(0,1000000)).padStart(6,'0'));
 await marker.write('smtp-accepted; inbox-delivery-unconfirmed\n');await marker.sync();
 console.log('SELF_SMTP_ACCEPTED one self-addressed message accepted; inbox delivery not verified.');
}catch{if(marker){await marker.write('failed-or-unknown; no-retry\n').catch(()=>{});await marker.sync().catch(()=>{});}console.log('SELF_SMTP_BLOCKED_OR_UNKNOWN no sensitive details; no retry permitted.');process.exitCode=1;}
finally{mailer?.close();await marker?.close();}
