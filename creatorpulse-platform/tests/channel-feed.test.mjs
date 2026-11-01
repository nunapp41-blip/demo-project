import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChannelFeed,getChannelFeed} from '../apps/api/channel-feed.mjs';
const id='UCBR8-60-B28hp2BmDPdntcQ';
const sample=`<?xml version="1.0" encoding="UTF-8"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>Google &amp; YouTube</title><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>Video &amp; a test</title><published>2026-11-02T00:00:00Z</published><media:group><media:community><media:statistics views="1234"/></media:community></media:group></entry><entry><yt:videoId>_9xZ7fJQAaA</yt:videoId><title>Other video</title></entry></feed>`;
test('public feed parses real supplied views and leaves missing views unavailable',()=>{const r=parseChannelFeed(sample,id);assert.equal(r.channelTitle,'Google & YouTube');assert.equal(r.items[0].views,1234);assert.equal(r.items[1].views,null);assert.equal(r.items[0].title,'Video & a test');});
test('keyless feed requests only fixed YouTube feed host',async()=>{let target='';const r=await getChannelFeed(id,{fetcher:async url=>{target=url;return {ok:true,text:async()=>sample}},now:()=>1730000000000});assert.equal(r.items.length,2);assert.equal(new URL(target).hostname,'www.youtube.com');assert.match(target,/feeds\/videos\.xml/);});
test('invalid channel rejected before making network request',async()=>{await assert.rejects(getChannelFeed('https://example.com'),e=>e.status===400);});
