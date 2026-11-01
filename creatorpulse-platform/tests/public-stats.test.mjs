import test from 'node:test';
import assert from 'node:assert/strict';
import {getPublicStats,snapshotVph} from '../apps/api/public-stats.mjs';
import {YouTubeClient} from '../apps/api/youtube.mjs';
const fixed=Date.parse('2026-11-02T10:00:00.000Z');
test('VPH is computed from snapshots, not lifetime average',()=>{
 const rows=[{checkedAt:'2026-11-02T09:00:00.000Z',views:100},{checkedAt:'2026-11-02T10:00:00.000Z',views:135}];
 assert.equal(snapshotVph(rows),35); assert.equal(snapshotVph(rows.slice(0,1)),null);
});
test('batchGetStats uses 2026 granular quota, caches public readings, preserves null fields',async()=>{
 const state={usage:{},publicVideoSnapshots:{}};
 const store={state,mutate:async fn=>fn(state)};
 let calls=0;
 const yt=new YouTubeClient({apiKey:'TEST_SERVER_ONLY',store,now:()=>fixed,fetcher:async url=>{
  calls++;assert.match(url,/videos:batchGetStats/);
  return {ok:true,json:async()=>({items:[{id:'dQw4w9WgXcQ',statistics:{viewCount:'101',likeCount:'8'}}]})};
 }});
 const a=await getPublicStats('dQw4w9WgXcQ',{yt,store,now:()=>fixed});
 const b=await getPublicStats('dQw4w9WgXcQ',{yt,store,now:()=>fixed+1000});
 assert.equal(a.views,101);assert.equal(a.comments,null);assert.equal(a.vph,null);assert.equal(b.cacheHit,true);assert.equal(calls,1);
 assert.equal(state.usage['2026-11-02'].units,0);assert.equal(state.usage['2026-11-02'].batchCalls,1);
});
test('unconfigured key fails explicitly without inventing view counts',async()=>{
 const state={usage:{}},store={state,mutate:async fn=>fn(state)};
 const yt=new YouTubeClient({apiKey:'',store});
 await assert.rejects(getPublicStats('dQw4w9WgXcQ',{yt,store}),e=>e.code==='YOUTUBE_API_NOT_CONFIGURED');
});
