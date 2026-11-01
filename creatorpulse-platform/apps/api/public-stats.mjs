import {ApiError,isVideoId} from './youtube.mjs';
const FRESH_MS=5*60*1000;
export function snapshotVph(rows){
  if(rows.length<2)return null;
  const a=rows.at(-2),b=rows.at(-1);
  const hours=(Date.parse(b.checkedAt)-Date.parse(a.checkedAt))/3600000;
  return hours>0&&Number.isFinite(a.views)&&Number.isFinite(b.views)?Math.max(0,Math.round((b.views-a.views)/hours*100)/100):null;
}
export async function getPublicStats(videoId,{yt,store,now=()=>Date.now()}){
  if(!isVideoId(videoId))throw new ApiError(400,'INVALID_VIDEO_ID','11-character video ID required.');
  if(!yt.configured)throw new ApiError(503,'YOUTUBE_API_NOT_CONFIGURED','YouTube Data API key is not configured; views are unavailable.');
  store.state.publicVideoSnapshots??={};
  const rows=store.state.publicVideoSnapshots[videoId]||[];
  const latest=rows.at(-1);
  if(latest&&now()-Date.parse(latest.checkedAt)<FRESH_MS)return {videoId,...latest,vph:snapshotVph(rows),source:latest.source,stale:false,cacheHit:true,persistence:'local_store_only'};
  try{
    const result=await yt.batchStats([videoId]);
    const item=result.items.find(x=>x.id===videoId);
    if(!item)throw new ApiError(404,'VIDEO_NOT_FOUND','Video not found or statistics unavailable.');
    const stats=item.statistics||{};
    const n=(v)=>v===undefined||v===null?null:Number.isSafeInteger(Number(v))?Number(v):null;
    const row={checkedAt:new Date(now()).toISOString(),views:n(stats.viewCount),likes:n(stats.likeCount),comments:n(stats.commentCount),source:'youtube_official_public',method:result.method,publishedAt:item.snippet?.publishTime||item.snippet?.publishedAt||null};
    await store.mutate(s=>{s.publicVideoSnapshots??={};const age=new Date(now()-29*86400e3).toISOString();const kept=(s.publicVideoSnapshots[videoId]||[]).filter(r=>r.checkedAt>=age);kept.push(row);s.publicVideoSnapshots[videoId]=kept.slice(-2000);for(const key of Object.keys(s.publicVideoSnapshots))s.publicVideoSnapshots[key]=(s.publicVideoSnapshots[key]||[]).filter(r=>r.checkedAt>=age);});
    return {videoId,...row,vph:snapshotVph(store.state.publicVideoSnapshots[videoId]),stale:false,cacheHit:false,persistence:'local_store_only'};
  }catch(e){if(latest)return {videoId,...latest,vph:snapshotVph(rows),stale:true,cacheHit:true,persistence:'local_store_only',refreshError:e.code||'UPSTREAM_ERROR'};throw e;}
}
