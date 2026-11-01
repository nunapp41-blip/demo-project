/** Separate self-hosted background worker for daily rank snapshots and official public RSS upload alerts. */
import {Accounts} from '../api/accounts.mjs';
import {JsonStore} from '../api/store.mjs';
import {YouTubeClient} from '../api/youtube.mjs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../../');
if(process.env.AUTH_MODE!=='accounts'||!process.env.ENCRYPTION_SECRET){console.error('Worker requires AUTH_MODE=accounts and ENCRYPTION_SECRET');process.exit(2);}
const accounts=new Accounts(process.env.SQLITE_FILE||path.join(root,'data/creators.sqlite'),process.env.ENCRYPTION_SECRET);
const store=await new JsonStore(process.env.DATA_FILE||path.join(root,'data/local.json')).init();
const yt=new YouTubeClient({apiKey:process.env.YOUTUBE_API_KEY||'',store});
let lastDaily='';const lastUploads=new Map();
async function runDaily(){
 if(!yt.configured)return;
 const day=new Date().toISOString().slice(0,10);if(lastDaily===day)return;lastDaily=day;
 for(const u of accounts.query('SELECT id FROM users'))for(const track of accounts.tracks(u.id)){
  try{const rank=await yt.rank(track.keyword,track.videoId,track.locale);accounts.addCheck(u.id,track.id,rank);}catch(err){console.error('Daily rank check failed:',err.message);return;}
 }
}
async function checkRss(){
 for(const u of accounts.query('SELECT id FROM users'))for(const comp of accounts.competitors(u.id)){
  try{
   const r=await fetch('https://www.youtube.com/feeds/videos.xml?channel_id='+comp.channelId,{signal:AbortSignal.timeout(10000)});
   if(!r.ok)continue;const xml=await r.text();const newest=xml.match(/<entry>[\s\S]*?<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/)?.[1];
   if(!newest)continue;const key=u.id+'|'+comp.channelId;const old=lastUploads.get(key);lastUploads.set(key,newest);
   // First observation is a baseline, never send a false "new upload" alert.
   if(old&&old!==newest)accounts.alert(u.id,'competitor_upload',{channelId:comp.channelId,videoId:newest});
  }catch(e){console.error('RSS error:',e.message);}
 }
}
async function tick(){try{await runDaily();await checkRss();}catch(e){console.error('worker error:',e);}}
console.log('CreatorPulse background worker started. Never run duplicate instances against the same SQLite database.');
await tick();setInterval(tick,15*60*1000);
