import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
test('hosted extension exchanges a one-time code and uses only its session-scoped token',async()=>{
  const source=readFileSync(new URL('../apps/extension/background.js',import.meta.url),'utf8');let listener;const session={},calls=[];
  const chrome={runtime:{onMessage:{addListener(fn){listener=fn;}}},storage:{session:{async get(key){return {[key]:session[key]};},async set(values){Object.assign(session,values);},async remove(key){delete session[key];}}}};
  const fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({data:url.endsWith('/token')?{token:'test-scoped-token'}:{title:'Actual title',views:12}})};};
  runInNewContext(source,{chrome,fetch,Error,JSON,String,encodeURIComponent});const request=message=>new Promise(resolve=>listener(message,{},resolve));
  assert.equal((await request({type:'CP_CONNECT',code:'one-time-code-123456789'})).ok,true);assert.equal((await request({type:'CP_STATUS'})).connected,true);
  const card=await request({type:'CP_GET_SCORECARD',videoId:'aaaaaaaaaaa'});assert.equal(card.data.views,12);assert.equal(calls[1].url,'https://creatorpulse-open-source-app.onrender.com/v1/videos/aaaaaaaaaaa/scorecard');assert.equal(calls[1].options.headers.authorization,'Bearer test-scoped-token');
  const before=calls.length;assert.equal((await request({type:'CP_GET_SCORECARD',videoId:'invalid'})).ok,false);assert.equal(calls.length,before);
  await request({type:'CP_DISCONNECT'});assert.equal((await request({type:'CP_STATUS'})).connected,false);assert.equal(source.includes('chrome.storage.local'),false);
});
