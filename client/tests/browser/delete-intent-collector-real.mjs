// Real commit with its original 200 held: both cancellation paths, BC and storage fallback.
// Runs from a clone after build:public; no success-body mocks, fixed sleeps or retries.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./delete-intent-real.mjs',import.meta.url));
for(const noBC of ['0','1'])for(const kind of ['cancel','batch-cancel']){
 const result=spawnSync(process.execPath,[script],{stdio:'inherit',env:{...process.env,NO_BC:noBC,CASE:kind,HOLD_DELETE_RESPONSE:'1'}});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
}
console.log('DELETE_COLLECTOR_REAL_PASS 4/4');
