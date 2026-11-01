import pg from 'pg';
import {randomBytes,createHash,scrypt as scryptCb,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {Accounts} from './accounts.mjs';
import {ApiError} from './youtube.mjs';
const scrypt=promisify(scryptCb),hash=s=>createHash('sha256').update(s).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
export const schemaSql=sql=>sql.replace(/\b(FROM|JOIN|INTO|UPDATE|REFERENCES|ON|TABLE IF NOT EXISTS)\s+(users|sessions|api_tokens|extension_codes|tracks|rank_checks|competitors|oauth_states|integrations|user_events|alerts|webhook_events|daily_usage|runtime_state|analytics_reports)\b/gi,(_match,keyword,table)=>`${keyword} creatorpulse.${table}`);

/** Dedicated managed Postgres storage; the local SQLite adapter stays available for development. */
export class PostgresAccounts {
  constructor(connectionString,secret){
    const uri=new URL(connectionString);
    const local=['localhost','127.0.0.1','::1'].includes(uri.hostname);
    for(const k of ['sslmode','sslcert','sslkey','sslrootcert','channel_binding'])uri.searchParams.delete(k);
    const pool=new pg.Pool({connectionString:uri.toString(),max:3,connectionTimeoutMillis:15000,idleTimeoutMillis:30000,ssl:local?false:{rejectUnauthorized:true}});
    this.pool={query:(sql,params)=>pool.query(schemaSql(sql),params),connect:async()=>{const client=await pool.connect();return {query:(sql,params)=>client.query(schemaSql(sql),params),release:()=>client.release()};},end:()=>pool.end()};
    this.key=secret?createHash('sha256').update(secret).digest():null;
  }
  async init(){
    await this.pool.query('CREATE SCHEMA IF NOT EXISTS creatorpulse');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,name TEXT NOT NULL,locale TEXT NOT NULL DEFAULT 'en',plan TEXT NOT NULL DEFAULT 'free',created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at BIGINT NOT NULL);
      CREATE TABLE IF NOT EXISTS api_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at BIGINT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS extension_codes(code_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at BIGINT NOT NULL);
      CREATE TABLE IF NOT EXISTS tracks(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,video_id TEXT NOT NULL,keyword TEXT NOT NULL,locale TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(user_id,video_id,keyword));
      CREATE TABLE IF NOT EXISTS rank_checks(id TEXT PRIMARY KEY,track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,position INTEGER,found INTEGER NOT NULL,checked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS competitors(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,channel_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(user_id,channel_id));
      CREATE TABLE IF NOT EXISTS oauth_states(state_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at BIGINT NOT NULL);
      CREATE TABLE IF NOT EXISTS integrations(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,refresh_token_enc TEXT NOT NULL,connected_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_events(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,event TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS alerts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT);
      CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,provider TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS daily_usage(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,day TEXT NOT NULL,kind TEXT NOT NULL,uses INTEGER NOT NULL,PRIMARY KEY(user_id,day,kind));
      CREATE TABLE IF NOT EXISTS runtime_state(id TEXT PRIMARY KEY,value JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS analytics_reports(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,video_id TEXT NOT NULL,report JSONB NOT NULL,checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(user_id,video_id));
      CREATE INDEX IF NOT EXISTS idx_cp_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_cp_rank_track ON rank_checks(track_id,checked_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cp_tracks_user ON tracks(user_id);
    `);
    return this;
  }
  async query(sql,...params){let index=0;return (await this.pool.query(sql.replace(/\?/g,()=>'$'+(++index)),params)).rows;}
  async one(sql,...params){return (await this.query(sql,...params))[0];}
  async run(sql,...params){let index=0;return {changes:(await this.pool.query(sql.replace(/\?/g,()=>'$'+(++index)),params)).rowCount};}
  encrypt(value){return Accounts.prototype.encrypt.call(this,value);}
  decrypt(value){return Accounts.prototype.decrypt.call(this,value);}
  async register(email,password,name){
    email=String(email||'').trim().toLowerCase();name=String(name||'').trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new ApiError(400,'EMAIL_INVALID','Enter a valid email address.');
    if(typeof password!=='string'||password.length<12||password.length>256)throw new ApiError(400,'PASSWORD_INVALID','Use 12–256 characters for your password.');
    if(name.length<2||name.length>70)throw new ApiError(400,'NAME_INVALID','Name must be 2–70 characters.');
    const salt=randomBytes(16).toString('hex'),derived=await scrypt(password,salt,64),id=random();
    try{await this.run('INSERT INTO users(id,email,password_hash,name,created_at) VALUES(?,?,?,?,?)',id,email,`${salt}:${derived.toString('hex')}`,name,new Date().toISOString());}
    catch(e){if(e.code==='23505')throw new ApiError(409,'ACCOUNT_EXISTS','An account with that email already exists.');throw e;}
    await this.event(id,'signup');return this.publicUser(id);
  }
  async login(email,password){
    const u=await this.one('SELECT * FROM users WHERE email=?',String(email||'').toLowerCase().trim());
    const [salt,hex]=(u?.password_hash||'00000000000000000000000000000000:'+Buffer.alloc(64).toString('hex')).split(':');
    const derived=await scrypt(String(password||''),salt,64),stored=Buffer.from(hex,'hex');
    if(!u||stored.length!==derived.length||!timingSafeEqual(stored,derived))throw new ApiError(401,'INVALID_LOGIN','Email or password is incorrect.');
    await this.event(u.id,'login');return this.publicUser(u.id);
  }
  async publicUser(id){const u=await this.one('SELECT id,email,name,locale,plan,created_at FROM users WHERE id=?',id);return u?{id:u.id,email:u.email,name:u.name,locale:u.locale,plan:u.plan,createdAt:u.created_at}:null;}
  async startSession(id,days=7){const token=random();await this.run('INSERT INTO sessions VALUES(?,?,?)',hash(token),id,Date.now()+days*86400e3);return token;}
  async findUser(token,kind='session'){if(!token||token.length>256)return null;const table=kind==='api'?'api_tokens':'sessions';const row=await this.one(`SELECT user_id FROM ${table} WHERE token_hash=? AND expires_at>?`,hash(token),Date.now());return row?this.publicUser(row.user_id):null;}
  async logout(token){if(token)await this.run('DELETE FROM sessions WHERE token_hash=?',hash(token));}
  async newExtensionCode(id){const code=randomBytes(18).toString('base64url');await this.run('INSERT INTO extension_codes VALUES(?,?,?)',hash(code),id,Date.now()+300000);return code;}
  async exchangeExtensionCode(code){const row=await this.one('DELETE FROM extension_codes WHERE code_hash=? AND expires_at>? RETURNING user_id',hash(String(code||'')),Date.now());if(!row)throw new ApiError(401,'CODE_EXPIRED','The extension code expired.');const token=random();await this.run('INSERT INTO api_tokens VALUES(?,?,?,?)',hash(token),row.user_id,Date.now()+30*86400e3,new Date().toISOString());return {token,expiresInDays:30};}
  async revokeTokens(id){await this.run('DELETE FROM api_tokens WHERE user_id=?',id);}
  async event(id,event){await this.run('INSERT INTO user_events VALUES(?,?,?,?)',random(),id,event,new Date().toISOString());}
  async stats(id){const row=await this.one('SELECT (SELECT count(*)::int FROM tracks WHERE user_id=?) AS tracked, (SELECT count(*)::int FROM competitors WHERE user_id=?) AS competitors, (SELECT count(*)::int FROM alerts WHERE user_id=? AND read_at IS NULL) AS alerts',id,id,id);return {trackedKeywords:row.tracked,competitors:row.competitors,alerts:row.alerts};}
  async tracks(id){return (await this.query('SELECT * FROM tracks WHERE user_id=? ORDER BY created_at DESC',id)).map(x=>({id:x.id,keyword:x.keyword,videoId:x.video_id,locale:x.locale,createdAt:x.created_at}));}
  async track(id,videoId,keyword,locale){
    const client=await this.pool.connect();const at=new Date().toISOString(),trackId=random();
    try{await client.query('BEGIN');const {rows:[u]}=await client.query('SELECT plan FROM users WHERE id=$1 FOR UPDATE',[id]);const limit={free:5,creator:25,agency:100}[u?.plan||'free'];const {rows:[count]}=await client.query('SELECT count(*)::int AS n FROM tracks WHERE user_id=$1',[id]);if(count.n>=limit)throw new ApiError(429,'TRACK_LIMIT',`Your plan allows ${limit} tracked keywords.`);await client.query('INSERT INTO tracks VALUES($1,$2,$3,$4,$5,$6)',[trackId,id,videoId,keyword,locale,at]);await client.query('COMMIT');}
    catch(e){await client.query('ROLLBACK');if(e.code==='23505')throw new ApiError(409,'ALREADY_TRACKED','This video and keyword are already tracked.');throw e;}finally{client.release();}
    return {id:trackId,videoId,keyword,locale,createdAt:at};
  }
  async getTrack(id,trackId){const x=await this.one('SELECT * FROM tracks WHERE id=? AND user_id=?',trackId,id);return x?{id:x.id,videoId:x.video_id,keyword:x.keyword,locale:x.locale}:null;}
  async removeTrack(id,trackId){return Boolean((await this.run('DELETE FROM tracks WHERE id=? AND user_id=?',trackId,id)).changes);}
  async checks(id,trackId){if(!await this.getTrack(id,trackId))throw new ApiError(404,'NOT_FOUND','Tracked keyword not found.');return (await this.query('SELECT * FROM rank_checks WHERE track_id=? ORDER BY checked_at DESC LIMIT 90',trackId)).map(x=>({position:x.position,found:!!x.found,checkedAt:x.checked_at})).reverse();}
  async addCheck(id,trackId,rank){if(!await this.getTrack(id,trackId))throw new ApiError(404,'NOT_FOUND','Tracked keyword not found.');const prev=await this.one('SELECT position FROM rank_checks WHERE track_id=? ORDER BY checked_at DESC LIMIT 1',trackId);await this.run('INSERT INTO rank_checks VALUES(?,?,?,?,?)',random(),trackId,rank.position,rank.found?1:0,rank.checkedAt);if(prev?.position&&rank.position&&Math.abs(rank.position-prev.position)>=5)await this.alert(id,'rank_change',{trackId,previous:prev.position,current:rank.position});return rank;}
  async competitors(id){return (await this.query('SELECT * FROM competitors WHERE user_id=? ORDER BY created_at DESC',id)).map(x=>({id:x.id,channelId:x.channel_id,createdAt:x.created_at}));}
  async addCompetitor(id,channelId){const entryId=random(),at=new Date().toISOString();try{await this.run('INSERT INTO competitors VALUES(?,?,?,?)',entryId,id,channelId,at);}catch(e){if(e.code==='23505')throw new ApiError(409,'ALREADY_TRACKED','This channel is already tracked.');throw e;}return {id:entryId,channelId,createdAt:at};}
  async removeCompetitor(id,entryId){return Boolean((await this.run('DELETE FROM competitors WHERE id=? AND user_id=?',entryId,id)).changes);}
  async state(id){const state=random();await this.run('INSERT INTO oauth_states VALUES(?,?,?)',hash(state),id,Date.now()+600000);return state;}
  async redeemState(state){const row=await this.one('DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING user_id',hash(String(state||'')),Date.now());if(!row)throw new ApiError(401,'BAD_OAUTH_STATE','Google authorization state expired or is invalid.');return row.user_id;}
  async connectGoogle(id,token){await this.run('INSERT INTO integrations VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET refresh_token_enc=excluded.refresh_token_enc,connected_at=excluded.connected_at',id,this.encrypt(token),new Date().toISOString());await this.event(id,'google_connected');}
  async googleToken(id){const x=await this.one('SELECT refresh_token_enc FROM integrations WHERE user_id=?',id);return x?this.decrypt(x.refresh_token_enc):null;}
  async disconnectGoogle(id){await this.run('DELETE FROM integrations WHERE user_id=?',id);await this.event(id,'google_disconnected');}
  async alert(id,kind,payload){await this.run('INSERT INTO alerts VALUES(?,?,?,?,?,NULL)',random(),id,kind,JSON.stringify(payload),new Date().toISOString());}
  async alerts(id){return (await this.query('SELECT * FROM alerts WHERE user_id=? ORDER BY created_at DESC LIMIT 50',id)).map(x=>({id:x.id,kind:x.kind,payload:JSON.parse(x.payload),createdAt:x.created_at,readAt:x.read_at}));}
  async markRead(id,entryId){return Boolean((await this.run('UPDATE alerts SET read_at=? WHERE id=? AND user_id=?',new Date().toISOString(),entryId,id)).changes);}
  async updatePreferences(id,{name,locale}){const old=await this.publicUser(id);if(!old)throw new ApiError(404,'NOT_FOUND','No such user.');const next=String(name??old.name).trim();if(next.length<2||next.length>70)throw new ApiError(400,'NAME_INVALID','Name must be 2–70 characters.');await this.run('UPDATE users SET name=?,locale=? WHERE id=?',next,locale==='hi'?'hi':'en',id);return this.publicUser(id);}
  async updatePlan(id,plan){if(!['free','creator','agency'].includes(plan))throw new ApiError(400,'BAD_PLAN','Unknown plan.');await this.run('UPDATE users SET plan=? WHERE id=?',plan,id);}
  async useFeature(id,kind){const plan=(await this.publicUser(id))?.plan||'free';const limit={free:{search:5,scorecard:30,ai:3},creator:{search:30,scorecard:300,ai:30},agency:{search:80,scorecard:1500,ai:100}}[plan]?.[kind];if(!limit)return {remaining:null};const day=new Date().toISOString().slice(0,10);const row=await this.one('INSERT INTO daily_usage VALUES(?,?,?,1) ON CONFLICT(user_id,day,kind) DO UPDATE SET uses=daily_usage.uses+1 WHERE daily_usage.uses<? RETURNING uses',id,day,kind,limit);if(!row)throw new ApiError(429,'PLAN_LIMIT',`Daily ${kind} limit reached.`);return {remaining:limit-row.uses};}
  async hasWebhookEvent(id){return Boolean(await this.one('SELECT id FROM webhook_events WHERE id=?',id));}
  async recordWebhookEvent(id,provider){await this.run('INSERT INTO webhook_events VALUES(?,?,?) ON CONFLICT DO NOTHING',id,provider,new Date().toISOString());}
  async deleteAccount(id){await this.run('DELETE FROM users WHERE id=?',id);}
  async saveAnalytics(id,videoId,report){await this.run('INSERT INTO analytics_reports(user_id,video_id,report) VALUES(?,?,?::jsonb) ON CONFLICT(user_id,video_id) DO UPDATE SET report=excluded.report,checked_at=now()',id,videoId,JSON.stringify(report));}
  async cleanup(){await this.pool.query("DELETE FROM sessions WHERE expires_at < (extract(epoch from now())*1000)::bigint; DELETE FROM api_tokens WHERE expires_at < (extract(epoch from now())*1000)::bigint; DELETE FROM extension_codes WHERE expires_at < (extract(epoch from now())*1000)::bigint; DELETE FROM oauth_states WHERE expires_at < (extract(epoch from now())*1000)::bigint; DELETE FROM rank_checks WHERE checked_at::timestamptz < now()-interval '29 days'; DELETE FROM user_events WHERE created_at::timestamptz < now()-interval '29 days'; DELETE FROM analytics_reports WHERE checked_at < now()-interval '29 days';");}
  async close(){await this.pool.end();}
}

/** Single-instance runtime state with serialized, transactional read-modify-write. */
export class PostgresStore {
  constructor(accounts){this.pool=accounts.pool;this.state=null;this.chain=Promise.resolve();this.durable=true;}
  async init(){await this.pool.query("INSERT INTO runtime_state(id,value) VALUES('main',$1::jsonb) ON CONFLICT DO NOTHING",[JSON.stringify({tracked:[],rankHistory:[],competitors:[],usage:{},createdAt:new Date().toISOString()})]);this.state=(await this.pool.query("SELECT value FROM runtime_state WHERE id='main'")).rows[0].value;return this;}
  async mutate(fn){const op=this.chain.then(async()=>{const client=await this.pool.connect();try{await client.query('BEGIN');const state=(await client.query("SELECT value FROM runtime_state WHERE id='main' FOR UPDATE")).rows[0].value;const result=await fn(state);await client.query("UPDATE runtime_state SET value=$1::jsonb,updated_at=now() WHERE id='main'",[JSON.stringify(state)]);await client.query('COMMIT');this.state=state;return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}});this.chain=op.catch(()=>{});return op;}
}
