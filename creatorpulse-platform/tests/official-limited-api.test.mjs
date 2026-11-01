import test from 'node:test';
import assert from 'node:assert/strict';
import {YouTubeClient} from '../apps/api/youtube.mjs';
const fixed=Date.parse('2026-11-02T12:00:00.000Z');
function makeClient(reply){const state={usage:{}};const store={state,mutate:async fn=>fn(state)};const calls=[];const client=new YouTubeClient({apiKey:'testing_not_real',store,now:()=>fixed,fetcher:async url=>{calls.push(String(url));return {ok:true,json:async()=>reply};}});return {client,calls};}
test('public comments map official API fields and cache repeats',async()=>{
 const v=makeClient({items:[{id:'thread1',snippet:{topLevelComment:{snippet:{authorDisplayName:'Creator',textDisplay:'Thanks!',likeCount:7,publishedAt:'2026-01-01T00:00:00Z'}},totalReplyCount:2}}]});
 const a=await v.client.publicComments('dQw4w9WgXcQ');const b=await v.client.publicComments('dQw4w9WgXcQ');
 assert.equal(a.comments[0].text,'Thanks!');assert.equal(a.comments[0].replyCount,2);assert.equal(b.comments.length,1);assert.equal(v.calls.length,1);assert.match(v.calls[0],/commentThreads/);
});
test('hidden subscriber count remains unavailable',async()=>{
 const v=makeClient({items:[{id:'UCBR8-60-B28hp2BmDPdntcQ',snippet:{title:'Channel'},statistics:{hiddenSubscriberCount:true,viewCount:'240',videoCount:'7',subscriberCount:'999'}}]});
 const c=await v.client.publicChannel('UCBR8-60-B28hp2BmDPdntcQ');assert.equal(c.subscribers,null);assert.equal(c.views,'240');
});
test('missing credentials reject comments without invented results',async()=>{
 const state={usage:{}};const client=new YouTubeClient({apiKey:'',store:{state,mutate:async fn=>fn(state)}});await assert.rejects(client.publicComments('dQw4w9WgXcQ'),e=>e.code==='YOUTUBE_API_NOT_CONFIGURED');
});
