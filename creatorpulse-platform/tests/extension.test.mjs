import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
test('hosted extension uses public scorecards without a connection code or user token',async()=>{
  const source=readFileSync(new URL('../apps/extension/background.js',import.meta.url),'utf8');let listener;const calls=[];
  const chrome={runtime:{onMessage:{addListener(fn){listener=fn;}}}};
  const fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({data:{videoId:'aaaaaaaaaaa',views:12,likes:2,comments:1}})};};
  runInNewContext(source,{chrome,fetch,Error,JSON,String,encodeURIComponent});const request=message=>new Promise(resolve=>listener(message,{},resolve));
  const status=await request({type:'CP_STATUS'});assert.equal(status.ok,true);assert.equal(status.mode,'public');assert.equal(status.connected,false);
  const card=await request({type:'CP_GET_SCORECARD',videoId:'aaaaaaaaaaa'});assert.equal(card.data.views,12);assert.equal(calls[0].url,'https://creatorpulse-open-source-app.onrender.com/v1/public/video/aaaaaaaaaaa/stats');assert.equal(calls[0].options,undefined);
  const before=calls.length;assert.equal((await request({type:'CP_GET_SCORECARD',videoId:'invalid'})).ok,false);assert.equal(calls.length,before);
  assert.equal(source.includes('extension/token'),false);assert.equal(source.includes('creatorpulseAccessToken'),false);
});
