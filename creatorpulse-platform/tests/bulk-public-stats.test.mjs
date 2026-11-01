import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVideoIds,getBulkPublicStats,getChannelLatestStats} from '../apps/api/bulk-public-stats.mjs';
const a='dQw4w9WgXcQ',b='aaaaaaaaaaa',channelId='UCBR8-60-B28hp2BmDPdntcQ';
const t0=Date.parse('2026-11-02T12:00:00.000Z');
const makeStore=()=>({state:{usage:{},publicVideoSnapshots:{}},async mutate(fn){return fn(this.state);}});
test('canonical YouTube URLs and IDs dedupe and reject offsite URLs',()=>{
 assert.deepEqual(parseVideoIds([a,'https://www.youtube.com/watch?v='+a+'&t=5','https://youtu.be/'+b]),[a,b]);
 assert.throws(()=>parseVideoIds(['https://notyoutube.com/watch?v='+a]),e=>e.code==='INVALID_VIDEO_URL');
 assert.throws(()=>parseVideoIds(Array.from({length:51},()=>a)),e=>e.status===400);
});
test('official bulk views collect snapshots, cache 5 minutes and calculate VPH after second sample',async()=>{
 const store=makeStore();let calls=0;let timestamp=t0;let views=100;
 const yt={configured:true,async batchStats(ids){calls++;assert.deepEqual(ids,[a,b]);return {method:'videos.batchGetStats',items:[{id:a,statistics:{viewCount:String(views),likeCount:'9',commentCount:'2'}},{id:b,statistics:{viewCount:'200',likeCount:'12',commentCount:'8'}}],summary:{succeededVideoCount:2}};}};
 const opts={yt,store,now:()=>timestamp};
 let result=await getBulkPublicStats([a,b],opts);assert.equal(result.items[0].views,100);assert.equal(result.items[1].comments,8);assert.equal(calls,1);assert.equal(result.items[0].vph,null);
 await getBulkPublicStats([a,b],opts);assert.equal(calls,1);
 timestamp+=10*60*1000;views=170;result=await getBulkPublicStats([a,b],opts);assert.equal(calls,2);assert.equal(result.items[0].vph,420);assert.equal(result.items[0].status,'REAL_PUBLIC');
});
test('missing stats stay unavailable and stale cache retains disclosure on upstream failure',async()=>{
 const store=makeStore();let timestamp=t0;let fail=false;
 const yt={configured:true,async batchStats(){if(fail)throw Object.assign(new Error('upstream'),{code:'UPSTREAM_DOWN'});return {items:[{id:a,statistics:{viewCount:'5'}}],method:'videos.batchGetStats'};}};
 const opts={yt,store,now:()=>timestamp};let result=await getBulkPublicStats([a,b],opts);
 assert.equal(result.available,1);assert.equal(result.unavailable,1);assert.equal(result.items[0].comments,null);assert.equal(result.items[1].views,null);
 timestamp+=10*60*1000;fail=true;result=await getBulkPublicStats([a,b],opts);assert.equal(result.items[0].stale,true);assert.equal(result.refreshError,'UPSTREAM_DOWN');assert.equal(result.items[1].status,'UNAVAILABLE');
});
test('requires configured Google project key to show official statistics',async()=>{
 await assert.rejects(getBulkPublicStats([a],{yt:{configured:false},store:makeStore()}),e=>e.code==='YOUTUBE_API_NOT_CONFIGURED');
});
test('channel recent uploads combine playlist video metadata and actual public views',async()=>{
 const store=makeStore();const yt={configured:true,async channel(id){assert.equal(id,channelId);return {snippet:{title:'Channel A'},statistics:{viewCount:'1000',hiddenSubscriberCount:true,subscriberCount:'400'},contentDetails:{relatedPlaylists:{uploads:'UUaaaa'}}};},async call(route){assert.equal(route,'playlistItems');return {items:[{contentDetails:{videoId:a},snippet:{title:'Latest Video'}}]};},async batchStats(ids){assert.deepEqual(ids,[a]);return {items:[{id:a,statistics:{viewCount:'123',likeCount:'2',commentCount:'3'}}],method:'videos.batchGetStats'};}};
 const result=await getChannelLatestStats(channelId,{yt,store,now:()=>t0});assert.equal(result.videos[0].title,'Latest Video');assert.equal(result.videos[0].views,123);assert.equal(result.channelStats.subscribers,null);
});
