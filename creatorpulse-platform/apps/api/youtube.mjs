import {viewsPerHour,outlierScore,engagementRate,median} from '../../packages/shared/scoring.mjs';

const YT='https://www.googleapis.com/youtube/v3/';
const ID=/^[A-Za-z0-9_-]{11}$/;
const CHANNEL=/^UC[A-Za-z0-9_-]{22}$/;
export class ApiError extends Error{
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
export class YouTubeClient{
  constructor({apiKey,store,fetcher=fetch,now=()=>Date.now(),quota=10000,searchLimit=100}){
    this.key=apiKey;this.store=store;this.fetcher=fetcher;this.now=now;
    this.dailyLimit=quota;this.searchLimit=searchLimit;this.cache=new Map();
  }
  get configured(){return Boolean(this.key);}
  async call(resource,params={},ttl=300000){
    if(!this.key)throw new ApiError(503,'YOUTUBE_API_NOT_CONFIGURED','Set YOUTUBE_API_KEY in the API environment to enable live public data.');
    const query=new URLSearchParams({...params,key:this.key});
    const cacheKey=resource+'?'+new URLSearchParams(params);
    const existing=this.cache.get(cacheKey);
    if(existing&&existing.expires>this.now())return existing.data;
    const day=new Date(this.now()).toISOString().slice(0,10); // local guard only; Google resets on PT time
    const search=resource==='search';
    const used=this.store.state.usage[day]||{units:0,searchCalls:0};
    if(search&&used.searchCalls>=this.searchLimit)throw new ApiError(429,'SEARCH_QUOTA_LIMIT','Daily YouTube search request budget reached.');
    if(used.units>=this.dailyLimit)throw new ApiError(429,'YOUTUBE_QUOTA_LIMIT','Daily YouTube API request budget reached.');
    // Count before making the request: invalid API calls can incur quota. All routes below are read-only.
    await this.store.mutate(s=>{const u=s.usage[day]||{units:0,searchCalls:0};u.units++;if(search)u.searchCalls++;s.usage[day]=u;});
    let res;
    try{res=await this.fetcher(`${YT}${resource}?${query}`,{signal:AbortSignal.timeout(12000)});}catch(err){throw new ApiError(502,'YOUTUBE_NETWORK_ERROR','YouTube API could not be reached: '+err.message);}
    const body=await res.json().catch(()=>({}));
    if(!res.ok){const msg=body?.error?.message||`YouTube API HTTP ${res.status}`;throw new ApiError(res.status===403?429:502,'YOUTUBE_API_ERROR',msg);}
    if(ttl>0)this.cache.set(cacheKey,{data:body,expires:this.now()+ttl});
    if(this.cache.size>400){for(const [k,v] of this.cache){if(v.expires<this.now())this.cache.delete(k);}if(this.cache.size>400)this.cache.delete(this.cache.keys().next().value);}
    return body;
  }
  async videos(ids){return (await this.call('videos',{part:'snippet,statistics,contentDetails',id:ids.join(',')},3600e3)).items||[];}
  async channel(channelId){if(!CHANNEL.test(channelId))throw new ApiError(400,'BAD_CHANNEL_ID','Expected a YouTube channel ID beginning with UC.');
    const items=(await this.call('channels',{part:'snippet,statistics,contentDetails',id:channelId},12*3600e3)).items||[];
    if(!items.length)throw new ApiError(404,'CHANNEL_NOT_FOUND','Channel not found.');return items[0];
  }
  async scorecard(videoId){
    if(!ID.test(videoId))throw new ApiError(400,'BAD_VIDEO_ID','Expected an 11-character YouTube video ID.');
    const video=(await this.videos([videoId]))[0];
    if(!video)throw new ApiError(404,'VIDEO_NOT_FOUND','Video not found or not publicly available.');
    const views=Number(video.statistics?.viewCount||0),likes=Number(video.statistics?.likeCount||0),comments=Number(video.statistics?.commentCount||0);
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
    return {ytVideoId:videoId,title:video.snippet?.title||'',channelTitle,channelId:video.snippet?.channelId,publishedAt:video.snippet?.publishedAt,thumbnail:video.snippet?.thumbnails?.medium?.url||null,views,likes,comments,vph:viewsPerHour(views,video.snippet?.publishedAt,this.now()),outlierScore:outlierScore(views,baseline),channelMedianViews:baseline,channelAverageViews:channelAverage,channelBaselineSample:baselineSize,engagementRate:engagementRate(likes,comments,views),tags:video.snippet?.tags||[],provenance:'youtube_data_api',isLive:true,notes:['VPH is average views divided by hours since publish, not a real-time view velocity.','Outlier uses the available sample of recent channel uploads; may be unavailable.']};
  }
  async searchVideos(q,{locale='en',region='US',maxResults=25}={}){
    const data=await this.call('search',{part:'snippet',q,type:'video',maxResults:String(Math.min(50,Math.max(1,maxResults))),relevanceLanguage:locale,regionCode:region},24*3600e3);
    return (data.items||[]).map((v,i)=>({videoId:v.id?.videoId,title:v.snippet?.title,channelTitle:v.snippet?.channelTitle,publishedAt:v.snippet?.publishedAt,position:i+1})).filter(x=>x.videoId);
  }
  async rank(keyword,videoId,locale='en'){
    const matches=await this.searchVideos(keyword,{locale,region:locale==='hi'?'IN':'US',maxResults:50});
    const found=matches.find(x=>x.videoId===videoId);
    return {position:found?.position??null,found:Boolean(found),checkedAt:new Date(this.now()).toISOString(),scope:'first_50_search_results',notes:'Ranking is a non-personalized API search snapshot for the configured region and language, not a universal YouTube position.'};
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
