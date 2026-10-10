// Fake-only concurrent process test. No SMTP, no upstream, no secrets.
import {AuthStore} from './auth.mjs';
process.once('message',({path,time,entries})=>{
 const s=new AuthStore(path,{now:()=>time});let successes=0;
 for(const [email,code] of entries){if(s.verify(email,code))successes++;}
 s.close();process.send(successes,()=>process.disconnect());
});
