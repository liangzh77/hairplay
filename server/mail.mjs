import {readFile,stat} from 'node:fs/promises';
import nodemailer from 'nodemailer';
export async function loadMailer(file){
 const info=await stat(file);if(info.mode&0o077)throw Error('Mail config must be owner-only');
 const v={};for(const line of (await readFile(file,'utf8')).split(/\r?\n/)){if(!line||line.startsWith('#'))continue;const m=/^(SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|SMTP_FROM)=(.+)$/.exec(line);if(!m||v[m[1]])throw Error('Invalid mail config');v[m[1]]=m[2];}
 if(Object.keys(v).length!==5||v.SMTP_PORT!=='465'||! /^[a-zA-Z0-9.-]+$/.test(v.SMTP_HOST)||! /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v.SMTP_FROM))throw Error('Mail config incomplete');
 const transport=nodemailer.createTransport({host:v.SMTP_HOST,port:465,secure:true,auth:{user:v.SMTP_USER,pass:v.SMTP_PASS},tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,logger:false,debug:false});
 return {self:v.SMTP_FROM,send:async(to,code)=>{const r=await transport.sendMail({from:v.SMTP_FROM,to,subject:'有型 · 登录验证码',text:`您的登录验证码：${code}。10分钟内有效，仅用于登录。若非本人操作，请忽略。`});if(!r.accepted?.length)throw Error('Mail not accepted');},close:()=>transport.close()};
}
