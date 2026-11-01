import test from 'node:test';import assert from 'node:assert/strict';
import {YouTubeClient,ApiError,quotaDay} from '../apps/api/youtube.mjs';
const state={usage:{}};const store={state,mutate:async fn=>fn(state)};
const mk=(fetcher,key='abc')=>new YouTubeClient({apiKey:key,store,fetcher,now:()=>Date.parse('2026-11-02T00:00:00Z')});
test('requires an API key and never invents live data',async()=>{const yt=mk(async()=>{},'');await assert.rejects(yt.scorecard('dQw4w9WgXcQ'),e=>e.code==='YOUTUBE_API_NOT_CONFIGURED');});
test('validates video ID before API call',async()=>{const yt=mk(async()=>{});await assert.rejects(yt.scorecard('invalid'),e=>e.status===400);});
test('retrieves, scores and caches official video stats',async()=>{let calls=0;const mock=async url=>{calls++;const u=new URL(url);const body=u.pathname.endsWith('/videos')?{items:u.searchParams.get('id').includes('a')?[{snippet:{title:'Demo Video',channelId:'UC0000000000000000000000',publishedAt:'2026-11-01T22:00:00Z'},statistics:{viewCount:'200',likeCount:'12',commentCount:'8'}}]:[]}:{items:[]};return {ok:true,json:async()=>body};};const yt=mk(mock);const d=await yt.scorecard('aaaaaaaaaaa');assert.equal(d.vph,100);assert.equal(d.engagementRate,10);assert.equal(d.provenance,'youtube_data_api');assert.equal(d.channelMedianViews,null);await yt.scorecard('aaaaaaaaaaa');assert.ok(calls<=3);});
test('search results state positions as snapshots',async()=>{const yt=mk(async url=>({ok:true,json:async()=>({items:[{id:{videoId:'aaaaaaaaaaa'},snippet:{title:'One'}},{id:{videoId:'bbbbbbbbbbb'},snippet:{title:'Two'}}]})}));const r=await yt.rank('youtube tips','bbbbbbbbbbb');assert.equal(r.position,2);assert.equal(r.found,true);assert.match(r.scope,/50/);});
test('channel handle lookup avoids search quota and preserves hidden subscriber counts',async()=>{
  const calls=[];const yt=mk(async url=>{const u=new URL(url);calls.push(u);return {ok:true,json:async()=>({items:[{id:'UC0000000000000000000000',snippet:{title:'Actual channel',customUrl:'@creator'},statistics:{hiddenSubscriberCount:true,subscriberCount:'123',viewCount:'456',videoCount:'7'}}]})};});
  const result=await yt.searchChannels('https://www.youtube.com/@creator');
  assert.equal(calls.length,1);assert.equal(calls[0].pathname,'/youtube/v3/channels');assert.equal(calls[0].searchParams.get('forHandle'),'@creator');
  assert.equal(result.results[0].subscribers,null);assert.equal(result.results[0].views,'456');assert.equal(result.source,'youtube_official_channels');
  await assert.rejects(yt.searchChannels('https://example.com/@creator'),{code:'BAD_CHANNEL_QUERY'});assert.equal(calls.length,1);
});
test('channel name search joins official channel statistics without fabricating missing counts',async()=>{
  const yt=mk(async url=>({ok:true,json:async()=>new URL(url).pathname.endsWith('/search')?{items:[{id:{channelId:'UC0000000000000000000000'}}]}:{items:[{id:'UC0000000000000000000000',snippet:{title:'Creator'},statistics:{viewCount:'1234'}}]}}));
  const result=await yt.searchChannels('Creator');assert.equal(result.results.length,1);assert.equal(result.results[0].views,'1234');assert.equal(result.results[0].subscribers,null);assert.equal(result.results[0].videoCount,null);
});
test('quota day follows the Pacific midnight reset and shares the non-search budget',async()=>{
  assert.equal(quotaDay(Date.parse('2026-11-02T07:59:00Z')),'2026-11-01');assert.equal(quotaDay(Date.parse('2026-11-02T08:00:00Z')),'2026-11-02');
  const local={usage:{}};let calls=0;const yt=new YouTubeClient({apiKey:'test-only',quota:1,store:{state:local,mutate:async fn=>fn(local)},fetcher:async()=>{calls++;return {ok:true,json:async()=>({items:[]})};}});
  await yt.batchStats(['aaaaaaaaaaa']);await assert.rejects(yt.videos(['bbbbbbbbbbb']),{code:'YOUTUBE_QUOTA_LIMIT'});assert.equal(calls,1);
});
test('cached official responses retain the original retrieval timestamp',async()=>{
  let clock=Date.parse('2026-11-02T12:00:00Z');const local={usage:{}};let calls=0;const yt=new YouTubeClient({apiKey:'test-only',now:()=>clock,store:{state:local,mutate:async fn=>fn(local)},fetcher:async()=>{calls++;return {ok:true,json:async()=>({items:[]})};}});
  const first=await yt.publicComments('aaaaaaaaaaa');clock+=60000;const cached=await yt.publicComments('aaaaaaaaaaa');assert.equal(first.checkedAt,cached.checkedAt);assert.equal(calls,1);
});
