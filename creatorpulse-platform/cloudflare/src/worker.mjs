/**
 * Deployable Cloudflare Worker + D1 public analytics layer.
 * Official YouTube API only, bounded quotas, provenance, stale fallback, 29-day deletion.
 * Requires independent Cloudflare account + official Google API key in Worker secret.
 * Not a real-user authentication service. Admin token is private and never exposed to frontend.
 */
const ID=/^[A-Za-z0-9_-]{11}$/;
const PUBLIC_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const MINUTE=60, DAY=86400;
function respond(status,obj,origin,env){const h={...PUBLIC_HEADERS};if(origin&&origin===env.ALLOWED_ORIGIN)h['access-control-allow-origin']=origin;return new Response(JSON.stringify(obj),{status,headers:h});}
function fail(status,code,message,origin,env){return respond(status,{error:{code,message}},origin,env);}
function validVideo(id){return ID.test(id||'');}
export function computeVph(a,b){if(!a||!b||a.views===null||b.views===null||!Number.isFinite(a.views)||!Number.isFinite(b.views)||b.collected_at<=a.collected_at)return null;return Math.max(0,Math.round((b.views-a.views)*360000/(b.collected_at-a.collected_at))/100);}
function quotaDate(time=Date.now()){const dt=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(time);const x=Object.fromEntries(dt.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return `${x.year}-${x.month}-${x.day}`;}
function configured(env){return Boolean(env.DB&&env.YOUTUBE_API_KEY);}
function limit(env,bucket){return Math.max(0,Math.min(bucket==='search'?100:10000,Number(env[bucket==='search'?'PUBLIC_SEARCH_DAILY_LIMIT':'PUBLIC_BATCH_DAILY_LIMIT']|| (bucket==='search'?80:2000))));}
async function accessAllowed(req,env){
  // Hash addresses using a private daily salt: never store raw visitor IPs.
  const raw=req.headers.get('CF-Connecting-IP')||'unknown';
  const salt=env.RATE_LIMIT_SALT;
  if(!salt||salt.length<20)return false;
  const stamp=Math.floor(Date.now()/600000)*600;
  const encoded=new TextEncoder().encode(`${salt}:${raw}:${stamp}`);
  const hash=await crypto.subtle.digest('SHA-256',encoded);
  const key=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
  await env.DB.prepare('INSERT OR IGNORE INTO public_rate_limits(hashed_visitor,window_start,count) VALUES(?,?,0)').bind(key,stamp).run();
  const r=await env.DB.prepare('UPDATE public_rate_limits SET count=count+1 WHERE hashed_visitor=? AND window_start=? AND count<12').bind(key,stamp).run();
  return (r.meta?.changes||0)>0;
}
async function claimQuota(env,bucket){const date=quotaDate(),max=limit(env,bucket);await env.DB.prepare('INSERT OR IGNORE INTO quota_usage(quota_date,bucket,calls) VALUES(?,?,0)').bind(date,bucket).run();const r=await env.DB.prepare('UPDATE quota_usage SET calls=calls+1 WHERE quota_date=? AND bucket=? AND calls<?').bind(date,bucket,max).run();return (r.meta?.changes||0)>0;}
async function google(env,path,params){const u=new URL('https://www.googleapis.com/youtube/v3/'+path);for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));u.searchParams.set('key',env.YOUTUBE_API_KEY);const ctrl=new AbortController();const id=setTimeout(()=>ctrl.abort(),12000);try{const r=await fetch(u,{signal:ctrl.signal});const result=await r.json().catch(()=>({}));if(!r.ok){const err=new Error(`YouTube API ${r.status}`);err.status=r.status;err.body=result;throw err;}return result;}finally{clearTimeout(id);}}
const numeric=x=>x===undefined||x===null?null:(Number.isSafeInteger(Number(x))?Number(x):null);
async function storeStat(env,row,stamp){await env.DB.prepare('INSERT OR IGNORE INTO public_video_snapshots(video_id,collected_at,views,likes,comments,source,method) VALUES (?,?,?,?,?,?,?)').bind(row.id,stamp,numeric(row.statistics?.viewCount),numeric(row.statistics?.likeCount),numeric(row.statistics?.commentCount),'youtube_data_api_public',row.method||'videos.batchGetStats').run();}
async function sampleStats(env,ids){if(!configured(env))return {ok:false,error:'API_KEY_MISSING'};const result=[];const stamp=Math.floor(Date.now()/1000);
 for(let i=0;i<ids.length;i+=50){const chunk=ids.slice(i,i+50);if(!await claimQuota(env,'batch'))return {ok:false,error:'BATCH_QUOTA_EXHAUSTED',sampled:result.length};
  let data;try{data=await google(env,'videos:batchGetStats',{part:'id,statistics',id:chunk.join(',')});}
  catch(e){return {ok:false,error:'YOUTUBE_UPSTREAM_ERROR',status:e.status||502,sampled:result.length};}
  for(const item of data.items||[]){if(!validVideo(item.id))continue;await storeStat(env,item,stamp);result.push(item.id);}
 }
 return {ok:true,sampled:result.length,ids:result};
}
async function snapshots(env,id,limit=30){return (await env.DB.prepare('SELECT video_id,collected_at,views,likes,comments,source,method FROM public_video_snapshots WHERE video_id=? ORDER BY collected_at DESC LIMIT ?').bind(id,Math.min(100,Math.max(1,limit))).all()).results||[];}
function statResponse(rows,id,{stale=false,refreshError=null}={}){if(!rows.length)return {videoId:id,source:'UNAVAILABLE',views:null,likes:null,comments:null,vph:null,stale:false,checkedAt:null};const latest=rows[0],earlier=rows[1];return {videoId:id,source:'REAL PUBLIC',views:latest.views,likes:latest.likes,comments:latest.comments,vph:earlier?computeVph(earlier,latest):null,vphSource:earlier?'CALCULATED':'UNAVAILABLE',stale,refreshError,checkedAt:new Date(latest.collected_at*1000).toISOString(),method:latest.method,retentionDays:29};}
async function videoHandler(id,env){let rows=await snapshots(env,id,2);const now=Math.floor(Date.now()/1000),fresh=rows[0]&&now-rows[0].collected_at<5*MINUTE;if(fresh)return {status:200,data:statResponse(rows,id)};const updated=await sampleStats(env,[id]);if(updated.ok){rows=await snapshots(env,id,2);return {status:200,data:statResponse(rows,id)};}if(rows.length)return {status:200,data:statResponse(rows,id,{stale:true,refreshError:updated.error})};return {status:503,data:statResponse(rows,id,{refreshError:updated.error})};}
async function searchHandler(env,url){if(!configured(env))return {status:503,error:'API_KEY_MISSING'};const q=(url.searchParams.get('q')||'').trim().replace(/\s+/g,' '),region=(url.searchParams.get('region')||'US').toUpperCase(),language=(url.searchParams.get('language')||'en').toLowerCase();if(q.length<2||q.length>100||!/^[A-Z]{2}$/.test(region)||!/^[a-z]{2}$/.test(language))return {status:400,error:'INVALID_SEARCH'};const fingerprint=`${q.toLowerCase()}\u001f${region}\u001f${language}`;const cached=await env.DB.prepare('SELECT collected_at,results_json FROM public_search_snapshots WHERE fingerprint=?').bind(fingerprint).first();const now=Math.floor(Date.now()/1000);if(cached&&now-cached.collected_at<6*3600)return {status:200,data:{query:q,region,language,source:'SEARCH SNAPSHOT',checkedAt:new Date(cached.collected_at*1000).toISOString(),results:JSON.parse(cached.results_json),cacheHit:true}};
 if(!await claimQuota(env,'search'))return cached?{status:200,data:{query:q,region,language,source:'STALE SEARCH SNAPSHOT',checkedAt:new Date(cached.collected_at*1000).toISOString(),results:JSON.parse(cached.results_json),cacheHit:true,stale:true}}:{status:429,error:'SEARCH_QUOTA_EXHAUSTED'};
 let data;try{data=await google(env,'search',{part:'snippet',type:'video',q,regionCode:region,relevanceLanguage:language,maxResults:'20'});}catch(e){return cached?{status:200,data:{query:q,region,language,source:'STALE SEARCH SNAPSHOT',checkedAt:new Date(cached.collected_at*1000).toISOString(),results:JSON.parse(cached.results_json),stale:true}}:{status:502,error:'YOUTUBE_SEARCH_ERROR'};}
 const results=(data.items||[]).filter(v=>validVideo(v.id?.videoId)).map((v,i)=>({videoId:v.id.videoId,title:v.snippet?.title??null,channelTitle:v.snippet?.channelTitle??null,position:i+1}));
 await env.DB.prepare('INSERT INTO public_search_snapshots(fingerprint,query,region,language,collected_at,results_json) VALUES(?,?,?,?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET collected_at=excluded.collected_at,results_json=excluded.results_json').bind(fingerprint,q,region,language,now,JSON.stringify(results)).run();
 return {status:200,data:{query:q,region,language,source:'SEARCH SNAPSHOT',checkedAt:new Date(now*1000).toISOString(),results,cacheHit:false,universalRanking:false}};
}
async function cleanup(env){const min=Math.floor(Date.now()/1000)-29*DAY;await env.DB.prepare('DELETE FROM public_video_snapshots WHERE collected_at<?').bind(min).run();await env.DB.prepare('DELETE FROM public_search_snapshots WHERE collected_at<?').bind(min).run();await env.DB.prepare('DELETE FROM quota_usage WHERE quota_date<?').bind(quotaDate(Date.now()-3*DAY)).run();await env.DB.prepare('DELETE FROM public_rate_limits WHERE window_start<?').bind(Math.floor(Date.now()/1000)-DAY).run();}
async function refreshTracked(env){if(!configured(env))return;const now=Math.floor(Date.now()/1000);const rows=(await env.DB.prepare('SELECT video_id,tier FROM tracked_videos WHERE (tier=\'high\' AND last_checked_at<?) OR (tier=\'normal\' AND last_checked_at<?) ORDER BY last_checked_at ASC LIMIT 50').bind(now-5*MINUTE,now-15*MINUTE).all()).results||[];
 for(let i=0;i<rows.length;i+=50){const part=rows.slice(i,i+50);const out=await sampleStats(env,part.map(x=>x.video_id));if(!out.ok)break;for(const item of part)await env.DB.prepare('UPDATE tracked_videos SET last_checked_at=? WHERE video_id=?').bind(now,item.video_id).run();}}
export default {
 async fetch(req,env){const origin=req.headers.get('Origin');const url=new URL(req.url);const p=url.pathname;if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':origin===env.ALLOWED_ORIGIN?origin:'null','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'authorization,content-type','access-control-max-age':'600'}});
  if(!env.DB)return fail(503,'D1_NOT_CONFIGURED','Cloudflare D1 binding is missing.',origin,env);
  if(req.method==='GET'&&p==='/api/status'){const date=quotaDate();const rows=(await env.DB.prepare('SELECT bucket,calls FROM quota_usage WHERE quota_date=?').bind(date).all()).results||[];return respond(200,{data:{backend:'cloudflare-worker',storage:'d1_persistent',officialApiConfigured:Boolean(env.YOUTUBE_API_KEY),checkedAt:new Date().toISOString(),quota:Object.fromEntries(rows.map(x=>[x.bucket,x.calls])),limits:{batch:limit(env,'batch'),search:limit(env,'search')},source:'REAL SERVICE STATUS'}},origin,env);}
  if(req.method==='GET'&&(p==='/api/video'||p==='/api/search')){if(!await accessAllowed(req,env))return fail(429,'RATE_LIMIT_OR_NOT_CONFIGURED','The rate limit is reached or RATE_LIMIT_SALT has not been set.',origin,env);}
  if(req.method==='GET'&&p==='/api/video'){const id=url.searchParams.get('id');if(!validVideo(id))return fail(400,'INVALID_VIDEO_ID','11-character video ID required.',origin,env);const r=await videoHandler(id,env);return respond(r.status,{data:r.data},origin,env);}
  if(req.method==='GET'&&p==='/api/history'){const id=url.searchParams.get('id');if(!validVideo(id))return fail(400,'INVALID_VIDEO_ID','11-character video ID required.',origin,env);const rows=await snapshots(env,id,40);return respond(200,{data:{videoId:id,source:'REAL PUBLIC',snapshots:rows.map(x=>({...x,collectedAt:new Date(x.collected_at*1000).toISOString()}))}},origin,env);}
  if(req.method==='GET'&&p==='/api/search'){const result=await searchHandler(env,url);return result.error?fail(result.status,result.error,result.error,origin,env):respond(result.status,{data:result.data},origin,env);}
  if(req.method==='POST'&&p==='/api/admin/track'){if(!env.ADMIN_TOKEN||req.headers.get('Authorization')!==`Bearer ${env.ADMIN_TOKEN}`)return fail(401,'UNAUTHORIZED','Admin authorization required.',origin,env);let data;try{data=await req.json();}catch{return fail(400,'BAD_JSON','Valid JSON required.',origin,env);}const id=data?.videoId,tier=data?.tier||'normal';if(!validVideo(id)||!['high','normal'].includes(tier))return fail(400,'INVALID_INPUT','Valid videoId and tier required.',origin,env);await env.DB.prepare('INSERT INTO tracked_videos(video_id,tier,last_checked_at) VALUES(?,?,0) ON CONFLICT(video_id) DO UPDATE SET tier=excluded.tier').bind(id,tier).run();return respond(201,{data:{videoId:id,tier}},origin,env);}
  return fail(404,'NOT_FOUND','Unknown endpoint.',origin,env);
 },
 async scheduled(_event,env,ctx){if(!env.DB)return;ctx.waitUntil((async()=>{await cleanup(env);await refreshTracked(env);})());}
};
