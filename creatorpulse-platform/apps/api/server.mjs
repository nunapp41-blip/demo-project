/** CreatorPulse app/API: local secure multiuser mode or public read-only demo. No dependencies. */
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {JsonStore} from './store.mjs';
import {Accounts} from './accounts.mjs';
import {YouTubeClient,ApiError,isVideoId,isChannelId} from './youtube.mjs';
import {googleStatus,googleAuthorizationUrl,googleCallback,retentionReport,stripeCheckout,verifyStripeSignature,handleStripeEvent,verifyRazorpayWebhook} from './integrations.mjs';
import {titleScore} from '../../packages/shared/scoring.mjs';
import {publicVideo} from './public-video.mjs';
const dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(dirname,'../../');const WEB_ROOT=path.resolve(root,'apps/web/public');
const PORT=Number(process.env.PORT||8787),HOST=process.env.HOST||'127.0.0.1';
const PUBLIC_DEMO=process.env.PUBLIC_DEMO==='1';
const AUTH_MODE=process.env.AUTH_MODE||'local';
const PUBLIC_ORIGIN=process.env.PUBLIC_ORIGIN||`http://127.0.0.1:${PORT}`;
const COOKIE_SECURE=process.env.SECURE_COOKIES==='1';
if(!['local','accounts'].includes(AUTH_MODE))throw Error('AUTH_MODE must be local or accounts.');
if(HOST!=='127.0.0.1'&&HOST!=='::1'&&!PUBLIC_DEMO&&AUTH_MODE!=='accounts')throw Error('Public server must use AUTH_MODE=accounts or PUBLIC_DEMO=1.');
if(HOST!=='127.0.0.1'&&HOST!=='::1'&&AUTH_MODE==='accounts'&&!PUBLIC_DEMO){
  if(!COOKIE_SECURE||!process.env.ENCRYPTION_SECRET||process.env.ENCRYPTION_SECRET.length<32||!process.env.PERSISTENT_STORAGE_CONFIRMED)throw Error('Public accounts need SECURE_COOKIES=1, a strong ENCRYPTION_SECRET, and PERSISTENT_STORAGE_CONFIRMED.');
}
const store=await new JsonStore(process.env.DATA_FILE||path.resolve(root,'data/local.json')).init();
const accounts=AUTH_MODE==='accounts'?new Accounts(process.env.SQLITE_FILE||path.resolve(root,'data/creators.sqlite'),process.env.ENCRYPTION_SECRET||''):null;
const yt=new YouTubeClient({apiKey:process.env.YOUTUBE_API_KEY||'',store,quota:Number(process.env.YOUTUBE_DAILY_QUOTA||10000)});
const originAllowed=origin=>origin===PUBLIC_ORIGIN||/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const extensionOrigins=/^chrome-extension:\/\/[a-p]{32}$/;
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
function headerBase(res){res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-frame-options','DENY');res.setHeader('permissions-policy','camera=(), microphone=(), geolocation=()');res.setHeader('strict-transport-security','max-age=31536000; includeSubDomains');}
function send(res,status,obj){headerBase(res);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(obj));}
function redirect(res,url,code=302){headerBase(res);res.writeHead(code,{location:url,'cache-control':'no-store'});res.end();}
function fail(res,e){const status=Number.isInteger(e.status)?e.status:500;if(status===500)console.error('server failure:',e);send(res,status,{error:{code:e.code||'INTERNAL_ERROR',message:status===500?'Internal server error':e.message}});}
function setCookie(res,token,age=7*86400){res.setHeader('set-cookie',`cp_session=${encodeURIComponent(token||'')}; HttpOnly; Path=/; SameSite=Lax; ${COOKIE_SECURE?'Secure; ':''}Max-Age=${token?age:0}`);}
function cookie(req,name){const value=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));return value?decodeURIComponent(value.slice(name.length+1)):null;}
async function raw(req,max=32768){let count=0;const chunks=[];for await(const chunk of req){count+=chunk.length;if(count>max)throw new ApiError(413,'BODY_TOO_LARGE','Request body exceeds allowed size.');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');}
async function body(req){try{return JSON.parse(await raw(req));}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(400,'BAD_JSON','Expected valid JSON request.');}}
function term(s){if(typeof s!=='string'||s.trim().length<2||s.length>120)throw new ApiError(400,'INVALID_KEYWORD','Keyword must contain 2–120 characters.');return s.trim().replace(/\s+/g,' ');}
function allowedOrigin(req,res){const origin=req.headers.origin;if(!origin)return;const allow=originAllowed(origin)||extensionOrigins.test(origin);if(allow){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','origin');res.setHeader('access-control-allow-credentials','true');res.setHeader('access-control-allow-headers','authorization, content-type, x-cp-client');res.setHeader('access-control-allow-methods','GET,POST,PATCH,DELETE,OPTIONS');}return allow;}
function isLocal(req){return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'');}
function user(req){if(!accounts)return {id:'local',name:'Local Creator',locale:'en',plan:'free'};const bearer=/^Bearer\s+([\w.~-]+)$/.exec(req.headers.authorization||'')?.[1];return bearer?accounts.findUser(bearer,'api'):accounts.findUser(cookie(req,'cp_session'));}
function requireUser(req){if(PUBLIC_DEMO)throw new ApiError(503,'DEMO_ONLY','This public preview is read-only. User accounts require persistent storage and a configured production backend.');const u=user(req);if(!u)throw new ApiError(401,'AUTH_REQUIRED','Sign in to access your private workspace.');return u;}
const loginAttempts=new Map();
const publicReads=new Map();
function publicReadLimit(req){const ip=req.socket.remoteAddress||'unknown';const n=publicReads.get(ip)||{count:0,at:Date.now()};if(Date.now()-n.at>5*60e3){n.count=0;n.at=Date.now();}n.count++;publicReads.set(ip,n);if(n.count>30)throw new ApiError(429,'PUBLIC_RATE_LIMIT','Try again in a few minutes.');if(publicReads.size>10000){for(const [key,value] of publicReads){if(Date.now()-value.at>5*60e3)publicReads.delete(key);}}}
function loginLimit(req){const ip=req.socket.remoteAddress||'unknown';const n=loginAttempts.get(ip)||{count:0,at:Date.now()};if(Date.now()-n.at>10*60e3){n.count=0;n.at=Date.now();}n.count++;loginAttempts.set(ip,n);if(n.count>25)throw new ApiError(429,'TOO_MANY_ATTEMPTS','Too many requests. Try again later.');}
async function serveStatic(p,res){let safe;try{safe=decodeURIComponent(p);}catch{throw new ApiError(400,'BAD_PATH','Malformed URL');}if(safe==='/')safe='/index.html';const filename=path.resolve(WEB_ROOT,'.'+safe);if(!filename.startsWith(WEB_ROOT+path.sep))throw new ApiError(403,'FORBIDDEN','Path not allowed.');let st;try{st=await stat(filename);}catch{throw new ApiError(404,'NOT_FOUND','Not found.');}if(!st.isFile())throw new ApiError(404,'NOT_FOUND','Not found.');headerBase(res);res.writeHead(200,{'content-type':MIME[path.extname(filename)]||'application/octet-stream','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'",'cache-control':p==='/index.html'?'no-cache':'public, max-age=300'});res.end(await readFile(filename));}
const app=createServer(async(req,res)=>{const requestId=randomUUID();res.setHeader('x-request-id',requestId);const permitted=allowedOrigin(req,res);const url=new URL(req.url||'/',PUBLIC_ORIGIN);const p=url.pathname;
  try{
    if(req.method==='OPTIONS'){res.writeHead(permitted?204:403);return res.end();}
    if(!isLocal(req)&&HOST!=='0.0.0.0'&&HOST!=='::')throw new ApiError(403,'LOCAL_ONLY','Local server only.');
    if(['POST','PATCH','DELETE','PUT'].includes(req.method)&&req.headers.origin&&!permitted)throw new ApiError(403,'ORIGIN_DENIED','Untrusted origin.');
    if(!p.startsWith('/v1/')&&!['/healthz','/readyz','/oauth/google/callback'].includes(p)){
      if(req.method!=='GET')throw new ApiError(405,'METHOD_NOT_ALLOWED','GET only.');return await serveStatic(p,res);
    }
    if(req.method==='GET'&&p==='/healthz')return send(res,200,{ok:true,version:'0.6.0',mode:PUBLIC_DEMO?'public_readonly_demo':AUTH_MODE});
    if(req.method==='GET'&&p==='/readyz')return send(res,200,{ok:true,storage:accounts?'sqlite':'local_json',youtubeConfigured:yt.configured,persistence:process.env.PERSISTENT_STORAGE_CONFIRMED==='1'});
    if(req.method==='GET'&&p==='/v1/system/status')return send(res,200,{data:{checkedAt:new Date().toISOString(),backend:{ready:true,mode:PUBLIC_DEMO?'public_readonly_demo':AUTH_MODE,version:'0.6.0'},features:{publicVideoMetadata:true,officialYouTubeStatistics:yt.configured&&!PUBLIC_DEMO,keywordSearch:yt.configured&&!PUBLIC_DEMO,rankSnapshots:yt.configured&&!PUBLIC_DEMO,privateAccounts:AUTH_MODE==='accounts'&&!PUBLIC_DEMO,ownerRetention:Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET)&&AUTH_MODE==='accounts'&&!PUBLIC_DEMO,paidCheckout:Boolean(process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_PRICE_CREATOR)&&AUTH_MODE==='accounts'&&!PUBLIC_DEMO},storage:{kind:accounts?'sqlite':'local_json',durableHosting:process.env.PERSISTENT_STORAGE_CONFIRMED==='1'},notes:['YouTube statistics reflect the most recent official API response, not instantaneous view events.','Provider credentials and approvals are required for real user functionality.']}});
    if(req.method==='GET'&&/^\/v1\/public\/video\/[A-Za-z0-9_-]{11}\/metadata$/.test(p)){publicReadLimit(req);return send(res,200,{data:await publicVideo(p.split('/')[4])});}
    if(req.method==='GET'&&p==='/v1/config')return send(res,200,{data:{youtubeConfigured:yt.configured,aiConfigured:process.env.ENABLE_OLLAMA==='1',authConnected:AUTH_MODE==='accounts'&&!PUBLIC_DEMO,billingConnected:Boolean(process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_PRICE_CREATOR),storage:accounts?'sqlite':'local_json',publicDemo:PUBLIC_DEMO,googleConfigured:Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET),warning:PUBLIC_DEMO?'Public preview: local demo only.':AUTH_MODE==='local'?'Local single-user development mode.':null}});
    if(req.method==='GET'&&p==='/v1/me'){const u=PUBLIC_DEMO?null:user(req);return send(res,200,{data:u?{...u,authenticated:!!accounts}:null});}
    if(req.method==='POST'&&p==='/v1/auth/register'){
      if(PUBLIC_DEMO||!accounts||process.env.ALLOW_REGISTRATION!=='1')throw new ApiError(503,'REGISTRATION_DISABLED','Registration is not enabled on this server.');loginLimit(req);const b=await body(req);const account=await accounts.register(b.email,b.password,b.name);setCookie(res,accounts.startSession(account.id));return send(res,201,{data:account});
    }
    if(req.method==='POST'&&p==='/v1/auth/login'){
      if(PUBLIC_DEMO||!accounts)throw new ApiError(503,'AUTH_DISABLED','Account login not enabled on this server.');loginLimit(req);const b=await body(req);const account=await accounts.login(b.email,b.password);setCookie(res,accounts.startSession(account.id));return send(res,200,{data:account});
    }
    if(req.method==='POST'&&p==='/v1/auth/logout'){const u=requireUser(req);if(accounts){accounts.logout(cookie(req,'cp_session'));setCookie(res,'');}return send(res,200,{data:{signedOut:true}});}
    if(req.method==='POST'&&p==='/v1/extension/code'){const u=requireUser(req);if(!accounts)throw new ApiError(503,'AUTH_DISABLED','Accounts required for extension tokens.');return send(res,200,{data:{code:accounts.newExtensionCode(u.id),expiresInSeconds:300}});}
    if(req.method==='POST'&&p==='/v1/extension/token'){if(PUBLIC_DEMO||!accounts)throw new ApiError(503,'AUTH_DISABLED','Extension login is not configured.');loginLimit(req);return send(res,200,{data:accounts.exchangeExtensionCode((await body(req)).code)});}
    if(req.method==='POST'&&p==='/v1/extension/revoke'){const u=requireUser(req);if(!accounts)throw new ApiError(503,'AUTH_DISABLED','No extension tokens enabled.');accounts.revokeTokens(u.id);return send(res,200,{data:{revoked:true}});}
    if(req.method==='GET'&&p==='/v1/demo/scorecard')return send(res,200,{data:{ytVideoId:'DEMO_ONLY',vph:1248,outlierScore:3.2,engagementRate:6.8,channelMedianViews:24800,tags:['youtube growth','content strategy'],provenance:'sample_data',isLive:false}});
    if(req.method==='POST'&&p==='/v1/title/analyze'){
      const b=await body(req);if(typeof b.title!=='string'||!b.title.trim()||b.title.length>180)throw new ApiError(400,'INVALID_TITLE','Provide a title with 1–180 characters.');return send(res,200,{data:titleScore(b.title,b.focusKeyword||'')});
    }
    if(req.method==='GET'&&p==='/v1/usage'){const u=requireUser(req);return send(res,200,{data:{usage:store.state.usage,trackedKeywords:accounts?.stats(u.id).trackedKeywords??store.state.tracked.length,dailySearchLimit:yt.searchLimit,limitUnits:yt.dailyLimit}});}
    if(req.method==='GET'&&p==='/v1/dashboard'){const u=requireUser(req);return send(res,200,{data:{user:u,stats:accounts?.stats(u.id)||{trackedKeywords:store.state.tracked.length,competitors:store.state.competitors.length},source:'private_records',note:'Public video view statistics are not available without a connected YouTube API key.'}});}
    if(req.method==='GET'&&p==='/v1/alerts'){const u=requireUser(req);return send(res,200,{data:accounts?.alerts(u.id)||[]});}
    if(req.method==='POST'&&/^\/v1\/alerts\/[^/]+\/read$/.test(p)){const u=requireUser(req);return send(res,200,{data:{read:!!accounts?.markRead(u.id,p.split('/')[3])}});}
    if(req.method==='PATCH'&&p==='/v1/settings'){const u=requireUser(req);if(!accounts)throw new ApiError(503,'AUTH_DISABLED','Settings require account mode.');return send(res,200,{data:accounts.updatePreferences(u.id,await body(req))});}
    if(req.method==='POST'&&p==='/v1/account/delete'){const u=requireUser(req),b=await body(req);if(b.confirm!=='DELETE MY ACCOUNT')throw new ApiError(400,'CONFIRM_REQUIRED','Type DELETE MY ACCOUNT to confirm.');if(!accounts)throw new ApiError(503,'AUTH_DISABLED','Account deletion requires account mode.');accounts.deleteAccount(u.id);setCookie(res,'');return send(res,200,{data:{deleted:true}});}
    if(req.method==='GET'&&/^\/v1\/videos\/[^/]+\/scorecard$/.test(p)){const u=requireUser(req);accounts?.useFeature(u.id,'scorecard');return send(res,200,{data:await yt.scorecard(p.split('/')[3])});}
    if(req.method==='GET'&&p==='/v1/keywords/research'){const u=requireUser(req);accounts?.useFeature(u.id,'search');const q=term(url.searchParams.get('q'));const locale=url.searchParams.get('locale')==='hi'?'hi':'en';return send(res,200,{data:await yt.keywordResearch(q,locale)});}
    if(req.method==='GET'&&p==='/v1/rank/track'){const u=requireUser(req);return send(res,200,{data:accounts?accounts.tracks(u.id):store.state.tracked});}
    if(req.method==='POST'&&p==='/v1/rank/track'){
      const u=requireUser(req),b=await body(req),keyword=term(b.keyword);if(!isVideoId(b.videoId))throw new ApiError(400,'INVALID_VIDEO_ID','Enter a valid 11-character YouTube video ID.');
      if(accounts)return send(res,201,{data:accounts.track(u.id,b.videoId,keyword,b.locale==='hi'?'hi':'en')});
      const item=await store.mutate(s=>{if(s.tracked.length>=100)throw new ApiError(429,'TRACK_LIMIT','Tracked keywords limit reached.');if(s.tracked.some(x=>x.videoId===b.videoId&&x.keyword.toLowerCase()===keyword.toLowerCase()))throw new ApiError(409,'ALREADY_TRACKED','Already tracking keyword for this video.');const row={id:randomUUID(),keyword,videoId:b.videoId,locale:b.locale==='hi'?'hi':'en',createdAt:new Date().toISOString()};s.tracked.push(row);return row;});return send(res,201,{data:item});
    }
    if(req.method==='DELETE'&&/^\/v1\/rank\/track\/[^/]+$/.test(p)){const u=requireUser(req),id=p.split('/').pop();const removed=accounts?accounts.removeTrack(u.id,id):await store.mutate(s=>{const original=s.tracked.length;s.tracked=s.tracked.filter(x=>x.id!==id);s.rankHistory=s.rankHistory.filter(x=>x.trackId!==id);return original!==s.tracked.length;});if(!removed)throw new ApiError(404,'NOT_FOUND','Tracked keyword not found.');return send(res,200,{data:{deleted:true}});}
    if(req.method==='GET'&&/^\/v1\/rank\/[^/]+\/history$/.test(p)){const u=requireUser(req),id=p.split('/')[3];return send(res,200,{data:accounts?accounts.checks(u.id,id):store.state.rankHistory.filter(x=>x.trackId===id).slice(-90)});}
    if(req.method==='POST'&&/^\/v1\/rank\/[^/]+\/check$/.test(p)){const u=requireUser(req),id=p.split('/')[3];const item=accounts?accounts.getTrack(u.id,id):store.state.tracked.find(x=>x.id===id);if(!item)throw new ApiError(404,'NOT_FOUND','Tracked keyword not found.');const result=await yt.rank(item.keyword,item.videoId,item.locale);if(accounts)accounts.addCheck(u.id,id,result);else await store.mutate(s=>s.rankHistory.push({trackId:id,...result}));return send(res,200,{data:result});}
    if(req.method==='GET'&&p==='/v1/competitors'){const u=requireUser(req);return send(res,200,{data:accounts?accounts.competitors(u.id):store.state.competitors});}
    if(req.method==='POST'&&p==='/v1/competitors'){const u=requireUser(req),b=await body(req);if(!isChannelId(b.channelId))throw new ApiError(400,'INVALID_CHANNEL_ID','Enter a valid YouTube channel ID.');if(accounts)return send(res,201,{data:accounts.addCompetitor(u.id,b.channelId)});const entry=await store.mutate(s=>{if(s.competitors.some(x=>x.channelId===b.channelId))throw new ApiError(409,'ALREADY_TRACKED','Already tracking channel.');const row={id:randomUUID(),channelId:b.channelId,createdAt:new Date().toISOString()};s.competitors.push(row);return row;});return send(res,201,{data:entry});}
    if(req.method==='DELETE'&&/^\/v1\/competitors\/[^/]+$/.test(p)){const u=requireUser(req);if(!accounts)throw new ApiError(503,'AUTH_DISABLED','Requires account mode.');const removed=accounts.removeCompetitor(u.id,p.split('/').pop());if(!removed)throw new ApiError(404,'NOT_FOUND','Channel not found.');return send(res,200,{data:{deleted:true}});}
    if(req.method==='GET'&&/^\/v1\/channels\/[^/]+\/outliers$/.test(p)){requireUser(req);const c=await yt.channel(p.split('/')[3]);return send(res,200,{data:{channelTitle:c.snippet?.title,subscriberCount:c.statistics?.subscriberCount,notes:'Channel metadata. Use the video scorecard for outlier estimate.',provenance:'youtube_data_api'}});}
    if(req.method==='GET'&&p==='/v1/google/status'){const u=requireUser(req);return send(res,200,{data:accounts?googleStatus(accounts,u.id):{configured:false,connected:false}});}
    if(req.method==='GET'&&p==='/v1/google/connect'){const u=requireUser(req);if(!accounts)throw new ApiError(503,'AUTH_DISABLED','Multiuser accounts are required to connect Google.');return send(res,200,{data:{authorizationUrl:googleAuthorizationUrl(accounts,u.id)}});}
    if(req.method==='GET'&&p==='/oauth/google/callback'){
      if(!accounts||PUBLIC_DEMO)throw new ApiError(503,'AUTH_DISABLED','Google sign-in is unavailable.');
      const id=await googleCallback(accounts,url.searchParams.get('state'),url.searchParams.get('code'));if(!accounts.publicUser(id))throw new ApiError(404,'NOT_FOUND','User not found.');return redirect(res,PUBLIC_ORIGIN+'/#retention?google=connected');
    }
    if(req.method==='POST'&&p==='/v1/google/disconnect'){const u=requireUser(req);if(!accounts)throw new ApiError(503,'AUTH_DISABLED','Accounts required.');accounts.disconnectGoogle(u.id);return send(res,200,{data:{disconnected:true}});}
    if(req.method==='GET'&&p==='/v1/retention/status'){const u=requireUser(req);return send(res,200,{data:accounts?googleStatus(accounts,u.id):{configured:false,connected:false,requires:'Account mode and Google OAuth'}});}
    if(req.method==='GET'&&/^\/v1\/retention\/[\w-]{11}$/.test(p)){const u=requireUser(req);if(!accounts)throw new ApiError(503,'AUTH_DISABLED','Connect your YouTube account first.');const d=await retentionReport(accounts,u.id,p.split('/')[3],url.searchParams.get('startDate'),url.searchParams.get('endDate'));return send(res,200,{data:d});}
    if(req.method==='POST'&&p==='/v1/billing/checkout'){const u=requireUser(req),b=await body(req);if(!['creator','agency'].includes(b.plan))throw new ApiError(400,'BAD_PLAN','Choose Creator or Agency.');return send(res,200,{data:await stripeCheckout(accounts,u.id,b.plan,PUBLIC_ORIGIN)});}
    if(req.method==='POST'&&p==='/v1/billing/webhook/stripe'){
      if(!accounts||PUBLIC_DEMO)throw new ApiError(503,'AUTH_DISABLED','Billing is not configured.');const evt=verifyStripeSignature(await raw(req,262144),req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);return send(res,200,{data:handleStripeEvent(accounts,evt)});
    }
    if(req.method==='POST'&&p==='/v1/billing/webhook/razorpay'){
      if(!accounts||PUBLIC_DEMO)throw new ApiError(503,'AUTH_DISABLED','Billing is not configured.');const evt=verifyRazorpayWebhook(await raw(req,262144),req.headers['x-razorpay-signature'],process.env.RAZORPAY_WEBHOOK_SECRET);accounts.recordWebhookEvent(evt?.payload?.subscription?.entity?.id||randomUUID(),'razorpay');return send(res,200,{data:{received:true,note:'No plan upgrade until subscription mapping is verified.'}});
    }
    if(req.method==='POST'&&p==='/v1/ai/titles'){
      const u=requireUser(req);accounts?.useFeature(u.id,'ai');if(process.env.ENABLE_OLLAMA!=='1')throw new ApiError(503,'OLLAMA_DISABLED','Run local Ollama and set ENABLE_OLLAMA=1.');const b=await body(req),topic=term(b.topic);const model=process.env.OLLAMA_MODEL||'llama3.2';const target=new URL('/api/generate',process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434');const r=await fetch(target,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,prompt:`Write 5 useful YouTube titles for: ${topic}. No unverifiable promises.`,stream:false}),signal:AbortSignal.timeout(45000)});if(!r.ok)throw new ApiError(502,'OLLAMA_ERROR','Local model did not respond.');const response=await r.json();return send(res,200,{data:{text:response.response,provenance:'local_ollama',model}});
    }
    throw new ApiError(404,'NOT_FOUND','Unknown endpoint.');
  }catch(e){fail(res,e);}
});
app.listen(PORT,HOST,()=>console.log(`CreatorPulse ${AUTH_MODE}${PUBLIC_DEMO?' read-only public demo':''} → http://${HOST}:${PORT}`));
if(process.env.ENABLE_LIVE_RANK_CHECKS==='1'&&yt.configured&&!PUBLIC_DEMO){
  let day='';setInterval(async()=>{const date=new Date().toISOString().slice(0,10);if(day===date)return;day=date;
    if(accounts){for(const u of accounts.query('SELECT id FROM users'))for(const row of accounts.tracks(u.id)){try{const result=await yt.rank(row.keyword,row.videoId,row.locale);accounts.addCheck(u.id,row.id,result);}catch(e){console.error('rank job',e.message);break;}}}
    else for(const row of store.state.tracked){try{const rank=await yt.rank(row.keyword,row.videoId,row.locale);await store.mutate(s=>s.rankHistory.push({trackId:row.id,...rank}));}catch(e){console.error('rank job',e.message);break;}}
  },15*60*1000).unref();
}
