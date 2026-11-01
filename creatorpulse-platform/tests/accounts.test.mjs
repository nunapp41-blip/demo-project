import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Accounts} from '../apps/api/accounts.mjs';
import {verifyStripeSignature} from '../apps/api/integrations.mjs';
import {createHmac} from 'node:crypto';

const root=path.resolve(import.meta.dirname,'..');

test('SQLite multiuser accounts isolate tracks, sessions, OAuth secrets, deletion',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'cp-user-'));
  const d=new Accounts(path.join(dir,'users.sqlite'),'use-a-stable-secret-of-minimum-32-chars-123');
  try{
    const alice=await d.register('ALICE@example.com','veryStrongPasswordOne!','Alice Creator');
    const bob=await d.register('bob@example.com','veryStrongPasswordTwo!','Bob Creator');
    assert.equal(alice.email,'alice@example.com');
    await assert.rejects(()=>d.login('alice@example.com','WrongPassword!!!'),{code:'INVALID_LOGIN'});
    assert.equal((await d.login('alice@example.com','veryStrongPasswordOne!')).id,alice.id);
    const cookie=d.startSession(alice.id);assert.equal(d.findUser(cookie).id,alice.id);
    const track=d.track(alice.id,'aaaaaaaaaaa','youtube growth','en');
    assert.equal(d.tracks(alice.id).length,1);assert.equal(d.tracks(bob.id).length,0);
    assert.equal(d.getTrack(bob.id,track.id),undefined);
    assert.throws(()=>d.checks(bob.id,track.id),{code:'NOT_FOUND'});
    assert.equal(d.removeTrack(bob.id,track.id),false);
    d.addCheck(alice.id,track.id,{position:32,found:true,checkedAt:new Date().toISOString()});
    d.addCheck(alice.id,track.id,{position:24,found:true,checkedAt:new Date(Date.now()+1).toISOString()});
    assert.equal(d.checks(alice.id,track.id).length,2);
    assert.equal(d.alerts(alice.id).length,1);
    const state=d.state(alice.id);assert.equal(d.redeemState(state),alice.id);assert.throws(()=>d.redeemState(state),{code:'BAD_OAUTH_STATE'});
    d.connectGoogle(alice.id,'secret-refresh-token');assert.equal(d.googleToken(alice.id),'secret-refresh-token');
    const oneTime=d.newExtensionCode(alice.id);const ex=d.exchangeExtensionCode(oneTime);assert.equal(d.findUser(ex.token,'api').id,alice.id);assert.throws(()=>d.exchangeExtensionCode(oneTime),{code:'CODE_EXPIRED'});
    d.deleteAccount(alice.id);assert.equal(d.findUser(cookie),null);assert.equal(d.findUser(ex.token,'api'),null);assert.equal(d.tracks(bob.id).length,0);
  }finally{d.close();await rm(dir,{recursive:true,force:true});}
});

test('Stripe webhook HMAC verification refuses tampering',()=>{
  const payload=JSON.stringify({id:'evt_example',type:'payment_intent.succeeded'});const ts=Math.round(Date.now()/1000),key='whsec_fake_for_tests';
  const digest=createHmac('sha256',key).update(`${ts}.${payload}`).digest('hex');
  assert.equal(verifyStripeSignature(payload,`t=${ts},v1=${digest}`,key).id,'evt_example');
  assert.throws(()=>verifyStripeSignature(payload+' ',`t=${ts},v1=${digest}`,key),{code:'BAD_SIGNATURE'});
  assert.throws(()=>verifyStripeSignature(payload,`t=${ts-500},v1=${digest}`,key),{code:'STALE_SIGNATURE'});
});

test('accounts mode API denies unauthenticated access, supports signup, login, isolation',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'cp-e2e-'));const port=19998;
  const proc=spawn(process.execPath,['apps/api/server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),PUBLIC_ORIGIN:`http://127.0.0.1:${port}`,HOST:'127.0.0.1',DATA_FILE:path.join(dir,'usage.json'),SQLITE_FILE:path.join(dir,'accounts.sqlite'),AUTH_MODE:'accounts',ALLOW_REGISTRATION:'1',ENCRYPTION_SECRET:'secure_secret_abcdefghijklmnopqrstuvwxyz_12345',YOUTUBE_API_KEY:''},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(proc.exitCode===null&&proc.signalCode===null){const closed=once(proc,'close');proc.kill();await closed;}await rm(dir,{recursive:true,force:true})});
  const base=`http://127.0.0.1:${port}`;
  async function req(route,opts={}){const r=await fetch(base+route,{...opts,headers:{'content-type':'application/json',...opts.headers}});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}};
  let ok=false;for(let i=0;i<50;i++){try{ok=(await req('/healthz')).status===200;if(ok)break;}catch{}await new Promise(r=>setTimeout(r,60));}assert.equal(ok,true);
  assert.equal((await req('/v1/rank/track')).status,401);
  const first=await req('/v1/auth/register',{method:'POST',body:JSON.stringify({name:'First User',email:'first@site.example',password:'MyFirstPassword12'})});assert.equal(first.status,201);const cookie=first.cookie;
  const add=await req('/v1/rank/track',{method:'POST',headers:{cookie},body:JSON.stringify({videoId:'aaaaaaaaaaa',keyword:'growth tips'})});assert.equal(add.status,201);
  const second=await req('/v1/auth/register',{method:'POST',body:JSON.stringify({name:'Second User',email:'second@site.example',password:'MyOtherPassword12'})});assert.equal(second.status,201);
  assert.equal((await req('/v1/rank/track',{headers:{cookie:second.cookie}})).data.data.length,0);
  assert.equal((await req('/v1/rank/'+add.data.data.id+'/history',{headers:{cookie:second.cookie}})).status,404);
  const foreign=await req('/v1/rank/track/'+add.data.data.id,{method:'DELETE',headers:{cookie:second.cookie}});assert.equal(foreign.status,404);
  assert.equal((await req('/v1/rank/track',{headers:{cookie}})).data.data.length,1);
  assert.equal((await req('/v1/google/status',{headers:{cookie}})).data.data.configured,false);
  assert.equal((await req('/v1/retention/aaaaaaaaaaa',{headers:{cookie}})).status,401);
});

test('public demo mode refuses signup and all private tracking',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cp-public-'));const port=19997;
 const proc=spawn(process.execPath,['apps/api/server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_FILE:path.join(dir,'json.json'),PUBLIC_DEMO:'1',YOUTUBE_API_KEY:''},stdio:'ignore'});
 t.after(async()=>{if(proc.exitCode===null&&proc.signalCode===null){const closed=once(proc,'close');proc.kill();await closed;}await rm(dir,{recursive:true,force:true})});
 let ready=false;for(let i=0;i<50;i++){try{const r=await fetch(`http://127.0.0.1:${port}/healthz`);if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,60))}assert.equal(ready,true);
 assert.equal((await fetch(`http://127.0.0.1:${port}/v1/rank/track`)).status,503);
 assert.equal((await fetch(`http://127.0.0.1:${port}/v1/title/analyze`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'How to make a better YouTube video title in 2026'})})).status,200);
 assert.equal((await fetch(`http://127.0.0.1:${port}/v1/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,503);
});
