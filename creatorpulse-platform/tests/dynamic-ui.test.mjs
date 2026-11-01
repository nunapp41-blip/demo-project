import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const dir=new URL('../apps/web/public/',import.meta.url);
const script=readFileSync(new URL('dynamic.js',dir),'utf8');
const html=readFileSync(new URL('index.html',dir),'utf8');
const premium=readFileSync(new URL('premium.css',dir),'utf8');
class Element {
  constructor(id=''){this.id=id;this.value='';this.textContent='';this.children=[];this.listeners={};this.disabled=false;this.className='';this.style={};this.href='';}
  addEventListener(type,callback){this.listeners[type]=callback;}
  querySelector(){return this.button;}
  replaceChildren(...items){this.children=[...items];this.textContent='';}
  append(...items){this.children.push(...items);}
}
function allText(node){return [node.textContent,...(node.children||[]).map(allText)].join(' ');}
const fixtures={
'/v1/public/video/dQw4w9WgXcQ/metadata':{title:'Actual public video',channel:'Actual channel',fetchedAt:'2026-11-02T00:00:00Z'},
'/v1/public/channel/UCBR8-60-B28hp2BmDPdntcQ/uploads':{channelTitle:'Public channel',results:[{title:'New video 2026',videoId:'dQw4w9WgXcQ',publishedAt:'2026-11-01T00:00:00Z',views:55}],stale:false,checkedAt:'2026-11-02T00:00:00Z'},
};
function createApp(){
 const ids=['cp-quick-video','cpVideo','cp-video-result','cp-quick-channel','cpChannel','cpChannelFilter','cp-channel-result','cp-quick-keyword','cpKeyword','cpRegion','cp-keyword-result'];
 const nodes=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
 for(const id of ['cp-quick-video','cp-quick-channel','cp-quick-keyword'])nodes[id].button=new Element(id+'-button');
 nodes.cpVideo.value='https://www.youtube.com/watch?v=dQw4w9WgXcQ';
 nodes.cpChannel.value='UCBR8-60-B28hp2BmDPdntcQ';
 nodes.cpKeyword.value='editing tutorials';nodes.cpRegion.value='US';
 const calls=[];
 const document={getElementById:id=>nodes[id],createElement:tag=>new Element(tag)};
 const fetch=async path=>{calls.push(path);if(path.startsWith('/v1/public/search'))return {ok:false,json:async()=>({error:{message:'Google API key not configured'}})};return {ok:!!fixtures[path],json:async()=>fixtures[path]?{data:fixtures[path]}:{error:{message:'Not found'}}};};
 runInNewContext(script,{document,URL,fetch,AbortController,setTimeout,clearTimeout,Date,Number,String,Error,encodeURIComponent});
 return {nodes,calls,async submit(id){await nodes[id].listeners.submit({preventDefault(){},currentTarget:nodes[id]});}};
}
test('homepage has three distinct real-data tools and keyboard-accessible forms',()=>{
 for(const id of ['cp-quick-video','cp-quick-channel','cp-quick-keyword','cp-video-result','cp-channel-result','cp-keyword-result'])assert.ok(html.includes(`id="${id}"`),id);
 assert.ok(html.includes('src="./dynamic.js"'));
});
test('homepage loads the restrained premium surface without removing research tools',()=>{
 assert.ok(html.includes('href="./premium.css"'));
 assert.match(html,/Make each upload/);
 assert.match(html,/Three useful tools/);
 assert.match(premium,/Premium minimal surface/);
 assert.match(premium,/premium-hero/);
});
test('video lookup displays actual returned metadata, never sample view counts',async()=>{
 const app=createApp();await app.submit('cp-quick-video');
 assert.equal(app.calls[0],'/v1/public/video/dQw4w9WgXcQ/metadata');
 assert.match(allText(app.nodes['cp-video-result']),/Actual public video/);
 assert.match(allText(app.nodes['cp-video-result']),/official YouTube Data API key/i);
 assert.equal(app.nodes['cp-quick-video'].button.disabled,false);
});
test('public channel lookup displays returned recent uploads',async()=>{
 const app=createApp();await app.submit('cp-quick-channel');
 assert.match(allText(app.nodes['cp-channel-result']),/New video 2026/);
 assert.match(allText(app.nodes['cp-channel-result']),/55/);
 assert.equal(app.nodes['cp-quick-channel'].button.disabled,false);
});
test('keyword search without Google key offers genuine YouTube search link, not invented results',async()=>{
 const app=createApp();await app.submit('cp-quick-keyword');
 const out=app.nodes['cp-keyword-result'];
 assert.match(allText(out),/Google API key not configured/);
 const links=out.children.filter(x=>x.href);
 assert.equal(links.length,1);
 assert.match(links[0].href,/youtube.com\/results\?search_query=editing%20tutorials/);
 assert.match(allText(out),/does not provide in-app analytics/);
});
