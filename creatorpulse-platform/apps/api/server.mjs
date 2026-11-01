import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {JsonStore} from './store.mjs';
import {YouTubeClient,ApiError,isVideoId,isChannelId} from './youtube.mjs';
import {titleScore} from '../../packages/shared/scoring.mjs';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT=path.resolve(__dirname,'../web/public');
const PORT=Number(process.env.PORT||8787),HOST=process.env.HOST||'127.0.0.1';
const STORE_PATH=process.env.DATA_FILE||path.resolve(__dirname,'../../data/local.json');
const store=await new JsonStore(STORE_PATH).init();
const yt=new YouTubeClient({apiKey:process.env.YOUTUBE_API_KEY||'',store,quota:Number(process.env.YOUTUBE_DAILY_QUOTA||10000)});
const extensionOrigins=/^chrome-extension:\/\/[a-p]{32}$/;
function send(res,status,obj){res.writeHead(status,{'content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff','cache-control':'no-store','referrer-policy':'no-referrer'});res.end(JSON.stringify(obj));}
function failure(res,e){const status=e.status||500;send(res,status,{error:{code:e.code||'INTERNAL_ERROR',message:status===500?'Internal server error':e.message}});if(status===500)console.error(e);}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
async function bodyJson(req){let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>16000)throw new ApiError(413,'BODY_TOO_LARGE','Payload exceeds 16 KB.');parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new ApiError(400,'BAD_JSON','Expected valid JSON body.');}}
function validateTerm(raw){if(typeof raw!=='string'||raw.trim().length<2||raw.length>120)throw new ApiError(400,'INVALID_KEYWORD','Keyword must contain 2–120 characters.');return raw.trim().replace(/\s+/g,' ');}
function localOnly(req){const address=req.socket.remoteAddress||'';return address==='127.0.0.1'||address==='::1'||address==='::ffff:127.0.0.1';}
function cors(req,res){const origin=req.headers.origin||'';const allowed=/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)||extensionOrigins.test(origin);if(allowed){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','origin');res.setHeader('access-control-allow-headers','content-type, x-cp-client');res.setHeader('access-control-allow-methods','GET, POST, DELETE, OPTIONS');}return allowed;}
async function serveStatic(p,res){let safe=decodeURIComponent(p);if(safe==='/'||safe==='/index.html')safe='/index.html';const candidate=path.resolve(WEB_ROOT,'.'+safe);if(!candidate.startsWith(WEB_ROOT+path.sep)&&candidate!==path.join(WEB_ROOT,'index.html'))throw new ApiError(403,'FORBIDDEN','Path not allowed.');let f;try{f=await stat(candidate);}catch{throw new ApiError(404,'NOT_FOUND','Not found.');}if(!f.isFile())throw new ApiError(404,'NOT_FOUND','Not found.');res.writeHead(200,{'content-type':mime[path.extname(candidate)]||'application/octet-stream','content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: https:; connect-src 'self'",'x-content-type-options':'nosniff'});res.end(await readFile(candidate));}
const app=createServer(async(req,res)=>{const validOrigin=cors(req,res);const url=new URL(req.url||'/',`http://${HOST}:${PORT}`);try{
  if(req.method==='OPTIONS'){res.writeHead(validOrigin?204:403);return res.end();}
  if(!localOnly(req))throw new ApiError(403,'LOCAL_ONLY','This development server accepts local connections only.');
  const p=url.pathname;
  if(!p.startsWith('/v1/')&&p!=='/healthz'&&p!=='/readyz'){if(req.method!=='GET')throw new ApiError(405,'METHOD_NOT_ALLOWED','GET only.');return await serveStatic(p,res);}
  if(req.method==='GET'&&p==='/healthz')return send(res,200,{ok:true,version:'0.2.0',mode:'self_hosted'});
  if(req.method==='GET'&&p==='/readyz')return send(res,200,{ok:true,storage:'json_local',youtubeConfigured:yt.configured});
  if(req.method==='GET'&&p==='/v1/me')return send(res,200,{data:{id:'local',name:'Local Creator',locale:'en',plan:'Local Developer',authMode:'localhost_only'}});
  if(req.method==='GET'&&p==='/v1/config')return send(res,200,{data:{youtubeConfigured:yt.configured,aiConfigured:process.env.ENABLE_OLLAMA==='1',authConnected:false,billingConnected:false,storage:'local_json',warning:'Not internet-exposed: no multiuser authentication.'}});
  if(req.method==='GET'&&p==='/v1/usage')return send(res,200,{data:{usage:store.state.usage,newSearchCallsPerDayDefault:100,limitUnits:yt.dailyLimit}});
  if(req.method==='POST'&&p==='/v1/title/analyze'){
    const b=await bodyJson(req);if(typeof b.title!=='string'||!b.title.trim()||b.title.length>180)throw new ApiError(400,'INVALID_TITLE','Provide 1–180 characters for title.');return send(res,200,{data:titleScore(b.title,b.focusKeyword||'')});}
  if(req.method==='GET'&&p==='/v1/demo/scorecard')return send(res,200,{data:{ytVideoId:'DEMO_ONLY',vph:1248,outlierScore:3.2,engagementRate:6.8,channelMedianViews:24800,tags:['youtube growth','content strategy'],provenance:'sample_data',isLive:false}});
  const match=p.match(/^\/v1\/videos\/([^/]+)\/scorecard$/);
  if(req.method==='GET'&&match)return send(res,200,{data:await yt.scorecard(match[1])});
  if(req.method==='GET'&&p==='/v1/keywords/research'){const term=validateTerm(url.searchParams.get('q'));const locale=url.searchParams.get('locale')==='hi'?'hi':'en';return send(res,200,{data:await yt.keywordResearch(term,locale)});}
  if(req.method==='GET'&&p==='/v1/rank/track')return send(res,200,{data:store.state.tracked});
  if(req.method==='POST'&&p==='/v1/rank/track'){
    const b=await bodyJson(req),term=validateTerm(b.keyword),videoId=b.videoId;
    if(!isVideoId(videoId))throw new ApiError(400,'INVALID_VIDEO_ID','Add a valid 11-character YouTube video ID.');
    const data=await store.mutate(s=>{if(s.tracked.length>=100)throw new ApiError(429,'TRACK_LIMIT','Local tracked keyword limit reached.');if(s.tracked.some(x=>x.videoId===videoId&&x.keyword.toLowerCase()===term.toLowerCase()))throw new ApiError(409,'ALREADY_TRACKED','Already tracking that keyword for this video.');const item={id:randomUUID(),keyword:term,videoId,locale:b.locale==='hi'?'hi':'en',createdAt:new Date().toISOString()};s.tracked.push(item);return item;});return send(res,201,{data});}
  if(req.method==='DELETE'&&/^\/v1\/rank\/track\/[^/]+$/.test(p)){
    const id=p.split('/').pop();const removed=await store.mutate(s=>{const n=s.tracked.length;s.tracked=s.tracked.filter(x=>x.id!==id);s.rankHistory=s.rankHistory.filter(x=>x.trackId!==id);return n!==s.tracked.length;});if(!removed)throw new ApiError(404,'NOT_FOUND','Tracking entry not found.');return send(res,200,{data:{deleted:true}});}
  const historyMatch=p.match(/^\/v1\/rank\/([^/]+)\/history$/);
  if(req.method==='GET'&&historyMatch)return send(res,200,{data:store.state.rankHistory.filter(x=>x.trackId===historyMatch[1]).slice(-90)});
  const runMatch=p.match(/^\/v1\/rank\/([^/]+)\/check$/);
  if(req.method==='POST'&&runMatch){const track=store.state.tracked.find(x=>x.id===runMatch[1]);if(!track)throw new ApiError(404,'NOT_FOUND','Tracked item not found.');const rank=await yt.rank(track.keyword,track.videoId,track.locale);const entry={trackId:track.id,...rank};await store.mutate(s=>s.rankHistory.push(entry));return send(res,200,{data:entry});}
  if(req.method==='GET'&&p==='/v1/competitors')return send(res,200,{data:store.state.competitors});
  if(req.method==='POST'&&p==='/v1/competitors'){const b=await bodyJson(req);if(!isChannelId(b.channelId))throw new ApiError(400,'INVALID_CHANNEL_ID','Expected a 24-character channel ID beginning UC.');const result=await store.mutate(s=>{if(s.competitors.some(x=>x.channelId===b.channelId))throw new ApiError(409,'ALREADY_TRACKED','Already tracking channel.');const entry={id:randomUUID(),channelId:b.channelId,createdAt:new Date().toISOString()};s.competitors.push(entry);return entry;});return send(res,201,{data:result});}
  if(req.method==='GET'&&/^\/v1\/channels\/[^/]+\/outliers$/.test(p)){const channelId=p.split('/')[3];const channel=await yt.channel(channelId);return send(res,200,{data:{channelTitle:channel.snippet?.title,subscriberCount:channel.statistics?.subscriberCount,notes:'Upload comparison is available through video scorecards. This endpoint is a channel metadata snapshot.',provenance:'youtube_data_api'}});}
  if(req.method==='GET'&&p==='/v1/retention/status')return send(res,200,{data:{connected:false,requires:'Google OAuth owner authorization and YouTube Analytics API'}});
  if(p.startsWith('/v1/retention/')||p.startsWith('/v1/billing/'))throw new ApiError(501,'NOT_IMPLEMENTED','This feature requires Google OAuth or a payment account and has not been activated.');
  if(req.method==='POST'&&p==='/v1/ai/titles'){
    if(process.env.ENABLE_OLLAMA!=='1')throw new ApiError(503,'OLLAMA_DISABLED','Run local Ollama and set ENABLE_OLLAMA=1 to use on-device AI.');
    const b=await bodyJson(req);const topic=validateTerm(b.topic);
    const model=process.env.OLLAMA_MODEL||'llama3.2',base=process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434';
    const result=await fetch(new URL('/api/generate',base),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,prompt:`Write 5 clear YouTube titles for this topic. Avoid clickbait and unverifiable promises. Topic: ${topic}`,stream:false}),signal:AbortSignal.timeout(45000)});
    if(!result.ok)throw new ApiError(502,'OLLAMA_ERROR','Local Ollama model did not respond successfully.');const reply=await result.json();return send(res,200,{data:{text:reply.response,provenance:'local_ollama',model}});
  }
  throw new ApiError(404,'NOT_FOUND','Unknown endpoint.');
}catch(err){failure(res,err);}});
app.listen(PORT,HOST,()=>console.log(`CreatorPulse locally running on http://${HOST}:${PORT} (YouTube API ${yt.configured?'configured':'not configured'})`));

if(process.env.ENABLE_LIVE_RANK_CHECKS==='1'&&yt.configured){
  let lastDay='';
  setInterval(async()=>{const day=new Date().toISOString().slice(0,10);if(lastDay===day)return;lastDay=day;for(const t of store.state.tracked){try{const rank=await yt.rank(t.keyword,t.videoId,t.locale);await store.mutate(s=>s.rankHistory.push({trackId:t.id,...rank}));}catch(e){console.error('Rank check failed:',t.id,e.message);break;}}},15*60*1000).unref();
}
