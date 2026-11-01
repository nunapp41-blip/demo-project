/** SQLite multi-tenant identity, sessions and creator records. Node 22+ built-in SQLite. */
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,scrypt as scryptCb,timingSafeEqual,createCipheriv,createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {ApiError} from './youtube.mjs';
const scrypt=promisify(scryptCb);
const hash=s=>createHash('sha256').update(s).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
export class Accounts {
  constructor(filename,secret=''){
    mkdirSync(path.dirname(path.resolve(filename)),{recursive:true});
    this.db=new DatabaseSync(path.resolve(filename));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.key=secret?createHash('sha256').update(secret).digest():null;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, name TEXT NOT NULL, locale TEXT NOT NULL DEFAULT 'en', plan TEXT NOT NULL DEFAULT 'free', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS api_tokens (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS extension_codes (code_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,video_id TEXT NOT NULL,keyword TEXT NOT NULL,locale TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(user_id,video_id,keyword));
      CREATE TABLE IF NOT EXISTS rank_checks (id TEXT PRIMARY KEY,track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, position INTEGER,found INTEGER NOT NULL,checked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS competitors (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,channel_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(user_id,channel_id));
      CREATE TABLE IF NOT EXISTS oauth_states (state_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS integrations (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,refresh_token_enc TEXT NOT NULL,connected_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_events (id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,event TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT);
      CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY,provider TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS daily_usage (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,day TEXT NOT NULL,kind TEXT NOT NULL,uses INTEGER NOT NULL,PRIMARY KEY(user_id,day,kind));
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_rank_checks_track ON rank_checks(track_id,checked_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tracks_user ON tracks(user_id);
    `);
  }
  query(sql,...params){return this.db.prepare(sql).all(...params);}
  one(sql,...params){return this.db.prepare(sql).get(...params);}
  run(sql,...params){return this.db.prepare(sql).run(...params);}
  async register(email,password,name){
    email=String(email||'').trim().toLowerCase();name=String(name||'').trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new ApiError(400,'EMAIL_INVALID','Enter a valid email address.');
    if(typeof password!=='string'||password.length<12||password.length>256)throw new ApiError(400,'PASSWORD_INVALID','Use 12–256 characters for your password.');
    if(name.length<2||name.length>70)throw new ApiError(400,'NAME_INVALID','Name must be 2–70 characters.');
    const salt=randomBytes(16).toString('hex');const derived=await scrypt(password,salt,64);
    const id=random();try{this.run('INSERT INTO users(id,email,password_hash,name,created_at) VALUES(?,?,?,?,?)',id,email,`${salt}:${derived.toString('hex')}`,name,new Date().toISOString());}
    catch(e){if(String(e.message).includes('UNIQUE'))throw new ApiError(409,'ACCOUNT_EXISTS','An account with that email already exists.');throw e;}
    this.event(id,'signup');return this.publicUser(id);
  }
  async login(email,password){const u=this.one('SELECT * FROM users WHERE email=?',String(email||'').toLowerCase().trim());const record=u?.password_hash||'00000000000000000000000000000000:'+Buffer.alloc(64).toString('hex');const [salt,hex]=record.split(':');const derived=await scrypt(String(password||''),salt,64);const stored=Buffer.from(hex,'hex');if(!u||stored.length!==derived.length||!timingSafeEqual(stored,derived))throw new ApiError(401,'INVALID_LOGIN','Email or password is incorrect.');this.event(u.id,'login');return this.publicUser(u.id);}
  publicUser(id){const u=this.one('SELECT id,email,name,locale,plan,created_at FROM users WHERE id=?',id);return u?{id:u.id,email:u.email,name:u.name,locale:u.locale,plan:u.plan,createdAt:u.created_at}:null;}
  startSession(userId,days=7){const token=random();this.run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',hash(token),userId,Date.now()+days*86400e3);return token;}
  findUser(token,kind='session'){if(!token||token.length>256)return null;const table=kind==='api'?'api_tokens':'sessions';const row=this.one(`SELECT user_id FROM ${table} WHERE token_hash=? AND expires_at>?`,hash(token),Date.now());return row?this.publicUser(row.user_id):null;}
  logout(token){if(token)this.run('DELETE FROM sessions WHERE token_hash=?',hash(token));}
  newExtensionCode(userId){const code=randomBytes(18).toString('base64url');this.run('INSERT INTO extension_codes(code_hash,user_id,expires_at) VALUES(?,?,?)',hash(code),userId,Date.now()+5*60e3);return code;}
  exchangeExtensionCode(code){const ch=hash(String(code||''));const entry=this.one('SELECT * FROM extension_codes WHERE code_hash=? AND expires_at>?',ch,Date.now());if(!entry)throw new ApiError(401,'CODE_EXPIRED','The extension code has expired. Generate a new one.');this.run('DELETE FROM extension_codes WHERE code_hash=?',ch);const token=random();this.run('INSERT INTO api_tokens(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',hash(token),entry.user_id,Date.now()+30*86400e3,new Date().toISOString());return {token,expiresInDays:30};}
  revokeTokens(userId){this.run('DELETE FROM api_tokens WHERE user_id=?',userId);}
  event(userId,event){this.run('INSERT INTO user_events VALUES(?,?,?,?)',random(),userId,event,new Date().toISOString());}
  stats(userId){return {trackedKeywords:this.one('SELECT count(*) n FROM tracks WHERE user_id=?',userId).n,competitors:this.one('SELECT count(*) n FROM competitors WHERE user_id=?',userId).n,alerts:this.one('SELECT count(*) n FROM alerts WHERE user_id=? AND read_at IS NULL',userId).n};}
  tracks(userId){return this.query('SELECT id,keyword,video_id videoId,locale,created_at createdAt FROM tracks WHERE user_id=? ORDER BY created_at DESC',userId);}
  track(userId,videoId,keyword,locale){const plan=this.publicUser(userId)?.plan||'free';const limit={free:5,creator:25,agency:100}[plan];if(this.stats(userId).trackedKeywords>=limit)throw new ApiError(429,'TRACK_LIMIT',`Your ${plan} plan allows ${limit} tracked keywords.`);const id=random(),at=new Date().toISOString();try{this.run('INSERT INTO tracks VALUES(?,?,?,?,?,?)',id,userId,videoId,keyword,locale,at);}catch(e){if(String(e.message).includes('UNIQUE'))throw new ApiError(409,'ALREADY_TRACKED','This video and keyword are already tracked.');throw e;}this.event(userId,'track_created');return {id,videoId,keyword,locale,createdAt:at};}
  getTrack(userId,id){return this.one('SELECT id,video_id videoId,keyword,locale FROM tracks WHERE id=? AND user_id=?',id,userId);}
  removeTrack(userId,id){return Boolean(this.run('DELETE FROM tracks WHERE id=? AND user_id=?',id,userId).changes);}
  checks(userId,id){if(!this.getTrack(userId,id))throw new ApiError(404,'NOT_FOUND','Tracked keyword not found.');return this.query('SELECT position,found,checked_at checkedAt FROM rank_checks WHERE track_id=? ORDER BY checked_at DESC LIMIT 90',id).map(x=>({...x,found:!!x.found})).reverse();}
  addCheck(userId,trackId,rank){if(!this.getTrack(userId,trackId))throw new ApiError(404,'NOT_FOUND','Tracked keyword not found.');const prev=this.one('SELECT position,found FROM rank_checks WHERE track_id=? ORDER BY checked_at DESC LIMIT 1',trackId);this.run('INSERT INTO rank_checks VALUES(?,?,?,?,?)',random(),trackId,rank.position,rank.found?1:0,rank.checkedAt);if(prev?.position&&rank.position&&Math.abs(rank.position-prev.position)>=5)this.alert(userId,'rank_change',{trackId,previous:prev.position,current:rank.position});return rank;}
  competitors(userId){return this.query('SELECT id,channel_id channelId,created_at createdAt FROM competitors WHERE user_id=? ORDER BY created_at DESC',userId);}
  addCompetitor(userId,channelId){const id=random(),at=new Date().toISOString();try{this.run('INSERT INTO competitors VALUES(?,?,?,?)',id,userId,channelId,at);}catch(e){if(String(e.message).includes('UNIQUE'))throw new ApiError(409,'ALREADY_TRACKED','This channel is already tracked.');throw e;}return {id,channelId,createdAt:at};}
  removeCompetitor(userId,id){return Boolean(this.run('DELETE FROM competitors WHERE user_id=? AND id=?',userId,id).changes);}
  state(userId){const state=random();this.run('INSERT INTO oauth_states VALUES(?,?,?)',hash(state),userId,Date.now()+10*60e3);return state;}
  redeemState(state){const h=hash(String(state||''));const row=this.one('SELECT user_id FROM oauth_states WHERE state_hash=? AND expires_at>?',h,Date.now());this.run('DELETE FROM oauth_states WHERE state_hash=?',h);if(!row)throw new ApiError(401,'BAD_OAUTH_STATE','Google authorization state expired or is invalid.');return row.user_id;}
  encrypt(value){if(!this.key)throw new ApiError(503,'ENCRYPTION_NOT_CONFIGURED','Set a stable ENCRYPTION_SECRET before Google connection.');const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',this.key,iv);const ciphertext=Buffer.concat([c.update(value,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),ciphertext]).toString('base64');}
  decrypt(payload){if(!this.key)throw new ApiError(503,'ENCRYPTION_NOT_CONFIGURED','Encryption is not configured.');const buf=Buffer.from(payload,'base64');const d=createDecipheriv('aes-256-gcm',this.key,buf.subarray(0,12));d.setAuthTag(buf.subarray(12,28));return Buffer.concat([d.update(buf.subarray(28)),d.final()]).toString('utf8');}
  connectGoogle(userId,refreshToken){this.run('INSERT INTO integrations VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET refresh_token_enc=excluded.refresh_token_enc,connected_at=excluded.connected_at',userId,this.encrypt(refreshToken),new Date().toISOString());this.event(userId,'google_connected');}
  googleToken(userId){const x=this.one('SELECT refresh_token_enc FROM integrations WHERE user_id=?',userId);return x?this.decrypt(x.refresh_token_enc):null;}
  disconnectGoogle(userId){this.run('DELETE FROM integrations WHERE user_id=?',userId);this.event(userId,'google_disconnected');}
  alert(userId,kind,payload){this.run('INSERT INTO alerts VALUES(?,?,?,?,?,NULL)',random(),userId,kind,JSON.stringify(payload),new Date().toISOString());}
  alerts(userId){return this.query('SELECT id,kind,payload,created_at createdAt,read_at readAt FROM alerts WHERE user_id=? ORDER BY created_at DESC LIMIT 50',userId).map(x=>({...x,payload:JSON.parse(x.payload)}));}
  markRead(userId,id){return Boolean(this.run('UPDATE alerts SET read_at=? WHERE id=? AND user_id=?',new Date().toISOString(),id,userId).changes);}
  updatePreferences(userId,{name,locale}){const old=this.publicUser(userId);if(!old)throw new ApiError(404,'NOT_FOUND','No such user.');const newName=String(name??old.name).trim();if(newName.length<2||newName.length>70)throw new ApiError(400,'NAME_INVALID','Name must be 2–70 characters.');const lang=locale==='hi'?'hi':'en';this.run('UPDATE users SET name=?,locale=? WHERE id=?',newName,lang,userId);return this.publicUser(userId);}
  updatePlan(userId,plan){if(!['free','creator','agency'].includes(plan))throw new ApiError(400,'BAD_PLAN','Unknown plan.');this.run('UPDATE users SET plan=? WHERE id=?',plan,userId);this.event(userId,'plan_updated');}
  useFeature(userId,kind){const plan=this.publicUser(userId)?.plan||'free';const caps={free:{search:5,scorecard:30,ai:3},creator:{search:30,scorecard:300,ai:30},agency:{search:80,scorecard:1500,ai:100}};const limit=caps[plan]?.[kind];if(!limit)return {remaining:null};const day=new Date().toISOString().slice(0,10);const row=this.one('SELECT uses FROM daily_usage WHERE user_id=? AND day=? AND kind=?',userId,day,kind);if((row?.uses||0)>=limit)throw new ApiError(429,'PLAN_LIMIT',`Daily ${kind} limit reached for ${plan} plan.`);this.run('INSERT INTO daily_usage VALUES(?,?,?,1) ON CONFLICT(user_id,day,kind) DO UPDATE SET uses=uses+1',userId,day,kind);return {remaining:limit-(row?.uses||0)-1};}
  hasWebhookEvent(id){return Boolean(this.one('SELECT id FROM webhook_events WHERE id=?',id));}
  recordWebhookEvent(id,provider){this.run('INSERT OR IGNORE INTO webhook_events VALUES(?,?,?)',id,provider,new Date().toISOString());}
  deleteAccount(userId){this.run('DELETE FROM users WHERE id=?',userId);}
  close(){this.db.close();}
}
