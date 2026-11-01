import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {YouTubeClient} from '../apps/api/youtube.mjs';
test('public browser screens use public endpoints, not auth-protected endpoints',async()=>{
 const [reality,live]=await Promise.all([readFile(new URL('../apps/web/public/reality.js',import.meta.url),'utf8'),readFile(new URL('../apps/web/public/live.js',import.meta.url),'utf8')]);
 assert.match(reality,/\/v1\/public\/search\?/);
 assert.doesNotMatch(reality,/\/v1\/keywords\/research\?/);
 assert.match(live,/\/v1\/public\/video\//);
 assert.doesNotMatch(live,/\/v1\/videos\/'/);
 assert.match(live,/\/v1\/public\/search\?/);
});
test('YouTube search can order results by date without synthesizing counts',async()=>{
 const urls=[];const store={state:{usage:{}},mutate:async fn=>fn(store.state)};
 const client=new YouTubeClient({apiKey:'mock-api-key',store,fetcher:async url=>{urls.push(new URL(url));return {ok:true,json:async()=>({items:[{id:{videoId:'dQw4w9WgXcQ'},snippet:{title:'Actual result title',channelTitle:'Channel'}}]})};}});
 const videos=await client.searchVideos('public keyword',{locale:'en',region:'US',order:'date',maxResults:5});
 assert.equal(videos.length,1);assert.equal(videos[0].title,'Actual result title');assert.equal(urls[0].searchParams.get('order'),'date');
});
