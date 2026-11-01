/** Keyless, real public metadata through YouTube's official oEmbed endpoint. No views, rankings or private stats. */
import {ApiError,isVideoId} from './youtube.mjs';
const cache = new Map();
export async function publicVideo(videoId,{fetcher=fetch,now=()=>Date.now()}={}){
  if(!isVideoId(videoId))throw new ApiError(400,'INVALID_VIDEO_ID','Expected 11-character YouTube video ID.');
  const cached=cache.get(videoId);
  if(cached && cached.until>now())return {...cached.value,fetchedAt:new Date(now()).toISOString(),cacheHit:true};
  // Fixed Google-controlled host, no arbitrary URL fetching/SSRF.
  const url='https://www.youtube.com/oembed?'+new URLSearchParams({url:`https://www.youtube.com/watch?v=${videoId}`,format:'json'});
  let r;
  try{r=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});}
  catch{throw new ApiError(502,'YOUTUBE_METADATA_UNAVAILABLE','The public YouTube metadata service is unavailable.');}
  if(r.status===401||r.status===403||r.status===404)throw new ApiError(404,'VIDEO_NOT_PUBLIC','Video is unavailable or does not permit embedding.');
  if(!r.ok)throw new ApiError(502,'YOUTUBE_METADATA_UNAVAILABLE',`Public YouTube metadata returned HTTP ${r.status}.`);
  let d;try{d=await r.json()}catch{throw new ApiError(502,'YOUTUBE_METADATA_INVALID','YouTube returned invalid metadata.');}
  const value={videoId,title:String(d.title||'').slice(0,300),channel:String(d.author_name||'').slice(0,140),
    channelUrl:typeof d.author_url==='string'&&d.author_url.startsWith('https://www.youtube.com/')?d.author_url:null,
    thumbnailUrl:`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,watchUrl:`https://www.youtube.com/watch?v=${videoId}`,
    source:'youtube_oembed',isRealPublicMetadata:true,views:null,vph:null,ranking:null,
    note:'Actual public title/channel retrieved from YouTube. This endpoint cannot retrieve views, VPH, ranking, or private analytics.'};
  cache.set(videoId,{value,until:now()+5*60*1000});
  if(cache.size>300)cache.delete(cache.keys().next().value);
  return {...value,fetchedAt:new Date(now()).toISOString(),cacheHit:false};
}
