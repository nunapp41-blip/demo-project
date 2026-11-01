import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const port=19999;
let proc,tmp;
async function call(p,opts){const r=await fetch(`http://127.0.0.1:${port}${p}`,opts);return {status:r.status,result:await r.json()};}
test('end to end local API endpoints, persistence and input validation',async t=>{
  tmp=await mkdtemp(path.join(os.tmpdir(),'cp-test-'));
  proc=spawn(process.execPath,['apps/api/server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_FILE:path.join(tmp,'store.json'),YOUTUBE_API_KEY:''},stdio:'ignore'});
  t.after(async()=>{proc.kill('SIGTERM');await rm(tmp,{force:true,recursive:true});});
  let started=false;for(let i=0;i<35;i++){try{if((await call('/healthz')).status===200){started=true;break;}}catch{}await new Promise(r=>setTimeout(r,90));}assert.equal(started,true,'API should start');
  assert.equal((await call('/v1/config')).result.data.youtubeConfigured,false);
  const status=await call('/v1/system/status');assert.equal(status.status,200);assert.equal(status.result.data.backend.version,'0.6.0');assert.equal(status.result.data.features.officialYouTubeStatistics,false);
  const sample=await call('/v1/demo/scorecard');assert.equal(sample.result.data.isLive,false);
  const missing=await call('/v1/videos/aaaaaaaaaaa/scorecard');assert.equal(missing.status,503);
  const score=await call('/v1/title/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'How to Grow a YouTube Channel in Thirty Days'})});assert.equal(score.status,200);assert.equal(score.result.data.isPrediction,false);
  const invalid=await call('/v1/rank/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({videoId:'bad',keyword:'youtube growth'})});assert.equal(invalid.status,400);
  const created=await call('/v1/rank/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({videoId:'aaaaaaaaaaa',keyword:'youtube growth'})});assert.equal(created.status,201);
  const tracked=await call('/v1/rank/track');assert.equal(tracked.result.data.length,1);
  const removed=await call('/v1/rank/track/'+created.result.data.id,{method:'DELETE'});assert.equal(removed.result.data.deleted,true);
  assert.equal((await call('/v1/rank/track')).result.data.length,0);
  const x=await fetch(`http://127.0.0.1:${port}/index.html`);assert.equal(x.status,200);assert.match(await x.text(),/CreatorPulse/);
});
