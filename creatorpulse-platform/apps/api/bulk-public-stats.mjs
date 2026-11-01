import {ApiError,isVideoId,isChannelId} from './youtube.mjs';

const FRESH_MS=5*60*1000;
const MAX_VIDEOS=50;
const VALID_TITLE='Published metadata from the channel uploads playlist';
const numberOrNull=x=>x===null||x===undefined||x===''?null:(Number.isSafeInteger(Number(x))&&Number(x)>=0?Number(x):null);

/** Only accepting canonical IDs prevents arbitrary URL fetching / SSRF. */
export function parseVideoIds(inputs){
  if(!Array.isArray(inputs)||inputs.length===0||inputs.length>MAX_VIDEOS)throw new ApiError(400,'INVALID_VIDEO_LIST','Enter 1–50 YouTube URLs or video IDs.');
  const ids=[];
  for(const item of inputs){
    if(typeof item!=='string'||item.length>300)throw new ApiError(400,'INVALID_VIDEO_ID','Invalid YouTube video input.');
    const value=item.trim();let id=value;
    if(value.startsWith('https://')){
      let url;
      try{url=new URL(value);}catch{throw new ApiError(400,'INVALID_VIDEO_URL','Invalid YouTube video URL.');}
      if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(url.hostname)){
        id=url.searchParams.get('v')||url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/)?.[1]||'';
      }else if(['youtu.be','www.youtu.be'].includes(url.hostname))id=url.pathname.match(/^\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1]||'';
      else throw new ApiError(400,'INVALID_VIDEO_URL','Use youtube.com or youtu.be URLs only.');
    }
    if(!isVideoId(id))throw new ApiError(400,'INVALID_VIDEO_ID','Each item must be a valid YouTube video ID or URL.');
    if(!ids.includes(id))ids.push(id);
  }
  return ids;
}

function historyVph(rows){
  if(rows.length<2)return null;
  const last=rows.at(-1),prev=rows.at(-2),seconds=(Date.parse(last.checkedAt)-Date.parse(prev.checkedAt))/1000;
  return seconds>0&&prev.views!==null&&last.views!==null&&last.views>=prev.views?Math.round((last.views-prev.views)*3600/seconds*100)/100:null;
}

export async function getBulkPublicStats(inputs,{yt,store,now=()=>Date.now()}={}){
  const ids=parseVideoIds(inputs);
  if(!yt.configured)throw new ApiError(503,'YOUTUBE_API_NOT_CONFIGURED','Official Google YouTube Data API key is not configured on this server.');
  const histories=store.state.publicVideoSnapshots||{};
  const freshness=new Date(now()-FRESH_MS).toISOString();
  const needs=ids.filter(id=>!histories[id]?.length||histories[id].at(-1).checkedAt<freshness);
  let method=null,summary=null,refreshError=null;
  let received=new Map();
  if(needs.length){
    try{
      const response=await yt.batchStats(needs);method=response.method;summary=response.summary;
      received=new Map(response.items.filter(v=>isVideoId(v.id)).map(v=>[v.id,v]));
      const timestamp=new Date(now()).toISOString();
      await store.mutate(s=>{
        s.publicVideoSnapshots??={};
        const cutoff=new Date(now()-29*86400e3).toISOString();
        for(const item of received.values()){
          const row={checkedAt:timestamp,views:numberOrNull(item.statistics?.viewCount),likes:numberOrNull(item.statistics?.likeCount),comments:numberOrNull(item.statistics?.commentCount),source:'youtube_official_public',method,publishedAt:item.snippet?.publishTime||item.snippet?.publishedAt||null};
          const history=(s.publicVideoSnapshots[item.id]||[]).filter(r=>r.checkedAt>=cutoff);
          history.push(row);s.publicVideoSnapshots[item.id]=history.slice(-300);
        }
        for(const key of Object.keys(s.publicVideoSnapshots)){
          s.publicVideoSnapshots[key]=(s.publicVideoSnapshots[key]||[]).filter(row=>row.checkedAt>=cutoff);
          if(!s.publicVideoSnapshots[key].length)delete s.publicVideoSnapshots[key];
        }
      });
    }catch(e){
      refreshError=e.code||'YOUTUBE_UPSTREAM_ERROR';
      if(!ids.some(id=>histories[id]?.length))throw e;
    }
  }
  const items=ids.map(videoId=>{
    const rows=store.state.publicVideoSnapshots?.[videoId]||[];
    if(!rows.length)return {videoId,available:false,views:null,likes:null,comments:null,checkedAt:null,vph:null,source:'youtube_official_public',status:'UNAVAILABLE'};
    const row=rows.at(-1);const isStale=now()-Date.parse(row.checkedAt)>=FRESH_MS;
    return {videoId,available:true,...row,vph:historyVph(rows),stale:isStale,status:isStale?'STALE':'REAL_PUBLIC',cacheHit:!received.has(videoId),historyPoints:rows.length};
  });
  return {items,checkedAt:new Date(now()).toISOString(),source:'youtube_official_public',requested:ids.length,available:items.filter(x=>x.available).length,unavailable:items.filter(x=>!x.available).length,batchMethod:method,providerSummary:summary,refreshError,persistence:'server_ephemeral_until_managed_db_configured',refreshIntervalSeconds:300,accuracy:'YouTube public API snapshot, not an instantaneous view event stream'};
}

export async function getChannelLatestStats(channelId,{yt,store,maxResults=25,now=()=>Date.now()}={}){
  if(!isChannelId(channelId))throw new ApiError(400,'INVALID_CHANNEL_ID','Channel ID must begin with UC and contain 24 characters.');
  if(!yt?.configured)throw new ApiError(503,'YOUTUBE_API_NOT_CONFIGURED','Google API key is required for official channel statistics.');
  const count=Math.min(MAX_VIDEOS,Math.max(1,Number(maxResults)||25));
  const channel=await yt.channel(channelId);
  const uploads=channel.contentDetails?.relatedPlaylists?.uploads;
  if(!uploads)throw new ApiError(404,'UPLOADS_PLAYLIST_UNAVAILABLE','This channel has no accessible uploads playlist.');
  const page=await yt.call('playlistItems',{part:'snippet,contentDetails',playlistId:uploads,maxResults:String(count)},5*60e3);
  const videos=(page.items||[]).map(x=>({videoId:x.contentDetails?.videoId||x.snippet?.resourceId?.videoId,title:x.snippet?.title||null,publishedAt:x.contentDetails?.videoPublishedAt||x.snippet?.publishedAt||null})).filter(v=>isVideoId(v.videoId));
  const stats=videos.length?await getBulkPublicStats(videos.map(v=>v.videoId),{yt,store,now}):{items:[],checkedAt:new Date(now()).toISOString(),source:'youtube_official_public'};
  const map=new Map(stats.items.map(v=>[v.videoId,v]));
  return {channelId,channelTitle:channel.snippet?.title||channelId,channelStats:{subscribers:channel.statistics?.hiddenSubscriberCount?null:numberOrNull(channel.statistics?.subscriberCount),views:numberOrNull(channel.statistics?.viewCount),videoCount:numberOrNull(channel.statistics?.videoCount)},checkedAt:new Date(now()).toISOString(),source:'youtube_official_api',videos:videos.map(v=>({...v,...map.get(v.videoId)})),count:videos.length,limit:count,nextPageAvailable:Boolean(page.nextPageToken),note:VALID_TITLE+'; latest accessible uploads only, not all historical uploads.'};
}
