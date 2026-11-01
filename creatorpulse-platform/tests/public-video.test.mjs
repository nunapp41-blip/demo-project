import test from 'node:test';import assert from 'node:assert/strict';import {publicVideo} from '../apps/api/public-video.mjs';
test('real public metadata endpoint parses YouTube oEmbed and avoids invented views',async()=>{
  let requested='';const fn=async u=>{requested=u;return {ok:true,status:200,json:async()=>({title:'Real title',author_name:'Real creator',author_url:'https://www.youtube.com/@creator'})}};
  const x=await publicVideo('bbbbbbbbbbb',{fetcher:fn,now:()=>1000});assert.match(requested,/youtube.com\/oembed/);assert.equal(x.title,'Real title');assert.equal(x.channel,'Real creator');assert.equal(x.views,null);assert.equal(x.isRealPublicMetadata,true);
});
test('video metadata rejects invalid IDs before external call',async()=>{await assert.rejects(publicVideo('not-an-id'),e=>e.status===400)});
