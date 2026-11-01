/** Public YouTube Atom feed client. No API keys or undocumented private endpoints. */
import {ApiError,isChannelId} from './youtube.mjs';
const cache = new Map();
const clean = str => String(str??'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||65533)).replace(/&#x([a-fA-F0-9]+);/g,(_,n)=>String.fromCodePoint(parseInt(n,16)||65533)).replace(/&(?:amp|lt|gt|quot|apos);/g,c=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"})[c]||c).replace(/<[^>]*>/g,'').trim();
const tag=(xml,name)=>clean(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]||'');
export function parseChannelFeed(xml,channelId){
  if(!/^<\?xml|^<feed\b/.test(xml.trim()))throw new ApiError(502,'FEED_INVALID','YouTube did not return a valid public Atom feed.');
  const entries=[...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].slice(0,15).map(m=>{
    const raw=m[1],videoId=tag(raw,'yt:videoId');
    if(!/^[\w-]{11}$/.test(videoId))return null;
    const viewsRaw=raw.match(/<media:statistics\b[^>]*\bviews=["'](\d+)["']/i)?.[1];
    return {videoId,title:tag(raw,'title').slice(0,250),publishedAt:tag(raw,'published')||null,updatedAt:tag(raw,'updated')||null,
      views:viewsRaw===undefined?null:Number(viewsRaw),watchUrl:`https://www.youtube.com/watch?v=${videoId}`,
      thumbnailUrl:`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`};
  }).filter(Boolean);
  return {channelId,channelTitle:tag(xml.split(/<entry\b/i)[0],'title').slice(0,150),items:entries,source:'youtube_public_atom_feed',
    note:'Latest public uploads only, normally up to 15. View counts are shown only when explicitly present in feed. No likes, subscriber count, private analytics, or universal search ranking.'};
}
export async function getChannelFeed(channelId,{fetcher=fetch,now=()=>Date.now()}={}){
  if(!isChannelId(channelId))throw new ApiError(400,'BAD_CHANNEL_ID','Use a 24-character channel ID starting with UC.');
  const previous=cache.get(channelId);
  if(previous&&previous.expires>now())return {...previous.value,cacheHit:true,stale:false};
  let response;
  try{
    response=await fetcher(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,{headers:{accept:'application/atom+xml, application/xml;q=0.9'},signal:AbortSignal.timeout(8500)});
    if(!response.ok)throw new ApiError(response.status===404?404:502,'FEED_UPSTREAM_ERROR',`YouTube public feed returned HTTP ${response.status}.`);
    const xml=await response.text();if(xml.length>2000000)throw new ApiError(502,'FEED_TOO_LARGE','YouTube response was unexpectedly large.');
    const value={...parseChannelFeed(xml,channelId),checkedAt:new Date(now()).toISOString()};
    cache.set(channelId,{value,expires:now()+5*60000});if(cache.size>300)cache.delete(cache.keys().next().value);
    return {...value,cacheHit:false,stale:false};
  }catch(e){
    if(previous&&now()-new Date(previous.value.checkedAt).getTime()<60*60000)
      return {...previous.value,cacheHit:true,stale:true,error:'Upstream unavailable; showing last successful feed.'};
    if(e instanceof ApiError)throw e;
    throw new ApiError(502,'FEED_UNAVAILABLE','YouTube channel feed is temporarily unavailable. Try again later.');
  }
}
