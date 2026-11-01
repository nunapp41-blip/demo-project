import {viewsPerHour,outlierScore,engagementRate,median} from '../../packages/shared/scoring.mjs';

const YT='https://www.googleapis.com/youtube/v3/';
const ID=/^[A-Za-z0-9_-]{11}$/;
const CHANNEL=/^UC[A-Za-z0-9_-]{22}$/;
export function quotaDay(timestamp=Date.now()){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(timestamp));const get=type=>parts.find(x=>x.type===type).value;return `${get('year')}-${get('month')}-${get('day')}`;}
export class ApiError extends Error{
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
export class YouTubeClient{
  constructor({apiKey,store,fetcher=fetch,now=()=>Date.now(),quota=10000,searchLimit=100}){
    this.key=apiKey;this.store=store;this.fetcher=fetcher;this.now=now;
    this.dailyLimit=quota;this.searchLimit=searchLimit;this.cache=new Map();this.timestamps=new WeakMap();
  }
  get configured(){return Boolean(this.key);}
  observedAt(data){return this.timestamps.get(data)||new Date(this.now()).toISOString();}
  async call(resource,params={},ttl=300000){
    if(!this.key)throw new ApiError(503,'YOUTUBE_API_NOT_CONFIGURED','Set YOUTUBE_API_KEY in the API environment to enable live public data.');
    const query=new URLSearchParams({...params,key:this.key});
    const cacheKey=resource+'?'+new URLSearchParams(params);
    const existing=this.cache.get(cacheKey);
    if(existing&&existing.expires>this.now())return existing.data;
    const day=quotaDay(this.now());
    const search=resource==='search';const batch=resource==='videos:batchGetStats';
    const used=this.store.state.usage[day]||{units:0,searchCalls:0};
    if(search&&used.searchCalls>=this.searchLimit)throw new ApiError(429,'SEARCH_QUOTA_LIMIT','Daily YouTube search request budget reached.');
    if(batch&&(used.batchCalls||0)>=10000)throw new ApiError(429,'BATCH_QUOTA_LIMIT','Daily YouTube batch video statistics request budget reached.');
    if(!search&&(used.units+(used.batchCalls||0))>=this.dailyLimit)throw new ApiError(429,'YOUTUBE_QUOTA_LIMIT','Daily YouTube API request budget reached.');
    // Count before making the request: invalid API calls can incur quota. All routes below are read-only.
    await this.store.mutate(s=>{const u=s.usage[day]||{units:0,searchCalls:0};if(search&&u.searchCalls>=this.searchLimit)throw new ApiError(429,'SEARCH_QUOTA_LIMIT','Daily YouTube search request budget reached.');if(!search&&(u.units+(u.batchCalls||0))>=this.dailyLimit)throw new ApiError(429,'YOUTUBE_QUOTA_LIMIT','Daily YouTube API request budget reached.');if(search)u.searchCalls++;else if(batch)u.batchCalls=(u.batchCalls||0)+1;else u.units++;s.usage[day]=u;});
    let res;
    try{res=await this.fetcher(`${YT}${resource}?${query}`,{signal:AbortSignal.timeout(12000)});}catch(err){throw new ApiError(502,'YOUTUBE_NETWORK_ERROR','YouTube API could not be reached: '+err.message);}
    const body=await res.json().catch(()=>({}));
    if(!res.ok){const msg=body?.error?.message||`YouTube API HTTP ${res.status}`;throw new ApiError([400,404,405,429].includes(res.status)?res.status:(res.status===403?429:502),'YOUTUBE_API_ERROR',msg);}
    const fetchedAt=new Date(this.now()).toISOString();this.timestamps.set(body,fetchedAt);for(const item of body.items||[])this.timestamps.set(item,fetchedAt);
    if(ttl>0)this.cache.set(cacheKey,{data:body,expires:this.now()+ttl});
    if(this.cache.size>400){for(const [k,v] of this.cache){if(v.expires<this.now())this.cache.delete(k);}if(this.cache.size>400)this.cache.delete(this.cache.keys().next().value);}
    return body;
  }
  async batchStats(ids){
    if(!Array.isArray(ids)||ids.length<1||ids.length>50||!ids.every(x=>ID.test(x)))throw new ApiError(400,'INVALID_VIDEO_IDS','Batch requires 1–50 valid YouTube video IDs.');
    try{
      const data=await this.call('videos:batchGetStats',{part:'id,statistics,contentDetails,snippet',id:ids.join(',')},5*60e3);
      return {items:data.items||[],method:'videos.batchGetStats',summary:data.summary||null};
    }catch(e){
      // Fallback only for endpoints genuinely unsupported, not quota exhaustion or bad credentials.
      if(!(e.status===404||e.status===405||e.code==='BATCH_UNSUPPORTED'))throw e;
      const data=await this.call('videos',{part:'snippet,statistics,contentDetails',id:ids.join(',')},5*60e3);
      return {items:data.items||[],method:'videos.list',summary:null};
    }
  }
  async videos(ids){return (await this.call('videos',{part:'snippet,statistics,contentDetails',id:ids.join(',')},3600e3)).items||[];}
  /** Public commentThreads.list: top-level visible comments only; no private analytics. */
  async publicComments(videoId,{maxResults=15,order='relevance'}={}){
    if(!ID.test(videoId))throw new ApiError(400,'BAD_VIDEO_ID','Expected an 11-character YouTube video ID.');
    const safeOrder=order==='time'?'time':'relevance';
    const count=Math.min(30,Math.max(1,Math.floor(Number(maxResults)||15)));
    const data=await this.call('commentThreads',{part:'snippet',videoId,maxResults:String(count),order:safeOrder,textFormat:'plainText'},5*60e3);
    return {videoId,source:'youtube_official_commentThreads',checkedAt:this.observedAt(data),totalResults:typeof data.pageInfo?.totalResults==='number'?data.pageInfo.totalResults:null,comments:(data.items||[]).map(x=>({id:x.id,author:x.snippet?.topLevelComment?.snippet?.authorDisplayName??'Unknown',text:x.snippet?.topLevelComment?.snippet?.textDisplay??'',likes:x.snippet?.topLevelComment?.snippet?.likeCount??null,publishedAt:x.snippet?.topLevelComment?.snippet?.publishedAt??null,replyCount:x.snippet?.totalReplyCount??null})),note:'Only publicly available top-level comments, not a complete export or private analytics.'};
  }
  async publicChannel(channelId){
    const c=await this.channel(channelId);
    return {channelId,title:c.snippet?.title??'',description:c.snippet?.description??'',thumbnail:c.snippet?.thumbnails?.medium?.url??null,subscribers:c.statistics?.hiddenSubscriberCount?null:(c.statistics?.subscriberCount??null),views:c.statistics?.viewCount??null,videoCount:c.statistics?.videoCount??null,source:'youtube_official_channels',checkedAt:this.observedAt(c)};
  }
  async searchChannels(query){
    let handle=null;
    if(query.startsWith('@'))handle=query;
    else if(query.startsWith('https://')){
      let u;try{u=new URL(query);}catch{throw new ApiError(400,'BAD_CHANNEL_QUERY','Enter a channel name or YouTube handle.');}
      if(!['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname)||!/^\/@[A-Za-z0-9_.-]+\/?$/.test(u.pathname))throw new ApiError(400,'BAD_CHANNEL_QUERY','Use a youtube.com/@handle URL.');
      handle=u.pathname.slice(1).replace(/\/$/,'');
    }
    if(handle&&!/^@[A-Za-z0-9_.-]{3,30}$/.test(handle))throw new ApiError(400,'BAD_CHANNEL_QUERY','Enter a valid YouTube handle.');
    let data;
    if(handle)data=await this.call('channels',{part:'snippet,statistics',forHandle:handle},300000);
    else{
      const matches=await this.call('search',{part:'snippet',q:query,type:'channel',maxResults:'10'},300000);
      const ids=(matches.items||[]).map(x=>x.id?.channelId).filter(x=>CHANNEL.test(x));
      data=ids.length?await this.call('channels',{part:'snippet,statistics',id:ids.join(',')},300000):{items:[]};
    }
    return {query,source:'youtube_official_channels',checkedAt:this.observedAt(data),results:(data.items||[]).map(c=>({channelId:c.id,title:c.snippet?.title||c.id,handle:c.snippet?.customUrl||null,subscribers:c.statistics?.hiddenSubscriberCount?null:(c.statistics?.subscriberCount??null),views:c.statistics?.viewCount??null,videoCount:c.statistics?.videoCount??null})),note:'Public counts may be rounded or hidden by YouTube. Name search is a sampled API result.'};
  }

  async channel(channelId){if(!CHANNEL.test(channelId))throw new ApiError(400,'BAD_CHANNEL_ID','Expected a YouTube channel ID beginning with UC.');
    const items=(await this.call('channels',{part:'snippet,statistics,contentDetails',id:channelId},12*3600e3)).items||[];
    if(!items.length)throw new ApiError(404,'CHANNEL_NOT_FOUND','Channel not found.');return items[0];
  }
  async scorecard(videoId){
    if(!ID.test(videoId))throw new ApiError(400,'BAD_VIDEO_ID','Expected an 11-character YouTube video ID.');
    const video=(await this.videos([videoId]))[0];
    if(!video)throw new ApiError(404,'VIDEO_NOT_FOUND','Video not found or not publicly available.');
    const count=value=>value==null?null:Number(value);const views=count(video.statistics?.viewCount),likes=count(video.statistics?.likeCount),comments=count(video.statistics?.commentCount);const history=this.store.state.publicVideoSnapshots?.[videoId]||[];const last=history.at(-1),previous=history.at(-2);const hours=last&&previous?(Date.parse(last.checkedAt)-Date.parse(previous.checkedAt))/3600000:0;const snapshotVelocity=hours>0&&last.views!=null&&previous.views!=null&&last.views>=previous.views?Math.round((last.views-previous.views)/hours*100)/100:null;
    let baseline=null,channelAverage=null,baselineSize=0,channelTitle=video.snippet?.channelTitle||'';
    try{
      const channel=await this.channel(video.snippet.channelId);
      channelTitle=channel.snippet?.title||channelTitle;
      const uploadId=channel.contentDetails?.relatedPlaylists?.uploads;
      if(uploadId){
        const uploads=await this.call('playlistItems',{part:'contentDetails',playlistId:uploadId,maxResults:'25'},6*3600e3);
        const ids=(uploads.items||[]).map(x=>x.contentDetails?.videoId).filter(x=>ID.test(x)&&x!==videoId).slice(0,20);
        if(ids.length){const videoList=await this.videos(ids);const values=videoList.map(x=>Number(x.statistics?.viewCount)).filter(Number.isFinite);baseline=median(values);baselineSize=values.length;channelAverage=values.length?Math.round(values.reduce((s,x)=>s+x,0)/values.length):null;}
      }
    }catch(e){/* still show public video's available statistics */}
    return {ytVideoId:videoId,title:video.snippet?.title||'',channelTitle,channelId:video.snippet?.channelId,publishedAt:video.snippet?.publishedAt,thumbnail:video.snippet?.thumbnails?.medium?.url||null,views,likes,comments,vph:snapshotVelocity,averageLifetimeVph:views==null?null:viewsPerHour(views,video.snippet?.publishedAt,this.now()),checkedAt:last?.checkedAt||this.observedAt(video),outlierScore:views==null?null:outlierScore(views,baseline),channelMedianViews:baseline,channelAverageViews:channelAverage,channelBaselineSample:baselineSize,engagementRate:likes==null||comments==null||views==null?null:engagementRate(likes,comments,views),tags:video.snippet?.tags||[],provenance:'youtube_data_api',isLive:true,notes:['VPH uses two timestamped public observations. averageLifetimeVph is a separate lifetime average.','Outlier uses the available sample of recent channel uploads; may be unavailable.']};
  }
  async searchVideos(q,{locale='en',region='US',maxResults=25,order='relevance'}={}){
    const data=await this.call('search',{part:'snippet',q,type:'video',maxResults:String(Math.min(50,Math.max(1,maxResults))),relevanceLanguage:locale,regionCode:region,order:order==='date'?'date':'relevance'},24*3600e3);
    const results=(data.items||[]).map((v,i)=>({videoId:v.id?.videoId,title:v.snippet?.title,channelTitle:v.snippet?.channelTitle,publishedAt:v.snippet?.publishedAt,position:i+1})).filter(x=>x.videoId);Object.defineProperty(results,'checkedAt',{value:this.observedAt(data)});return results;
  }
  async rank(keyword,videoId,locale='en'){
    const matches=await this.searchVideos(keyword,{locale,region:locale==='hi'?'IN':'US',maxResults:50});
    const found=matches.find(x=>x.videoId===videoId);
    return {position:found?.position??null,found:Boolean(found),checkedAt:matches.checkedAt,scope:'first_50_search_results',notes:'Ranking is a non-personalized API search snapshot for the configured region and language, not a universal YouTube position.'};
  }
  async keywordResearch(q,locale='en'){
    const results=await this.searchVideos(q,{locale,region:locale==='hi'?'IN':'US',maxResults:20});
    const ids=results.map(x=>x.videoId);
    const videos=ids.length?await this.videos(ids):[];
    const total=videos.reduce((s,v)=>s+Number(v.statistics?.viewCount||0),0);
    const avgViews=videos.length?Math.round(total/videos.length):0;
    const freshness=results.filter(x=>this.now()-new Date(x.publishedAt).getTime()<90*86400e3).length;
    // This is a transparent heuristic, not search-volume data or official difficulty.
    const competitionProxy=Math.round(100*Math.min(1,Math.log10(avgViews+1)/7));
    const interestProxy=Math.round(100*Math.min(1,Math.log10(total+1)/9));
    const score=Math.round(.55*interestProxy+.25*(100-competitionProxy)+.20*(100-freshness/Math.max(1,results.length)*100));
    return {term:q,locale,estimatedScore:score,demandProxy:interestProxy,competitionProxy,avgTopViews:avgViews,recentUploads:freshness,sampleSize:videos.length,results:results.slice(0,12),method:'estimated_top_search_result_proxies',isSearchVolume:false,provenance:'youtube_data_api'};
  }
}
export function isVideoId(s){return ID.test(s);}
export function isChannelId(s){return CHANNEL.test(s);}
