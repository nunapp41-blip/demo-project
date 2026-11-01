import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {PostgresAccounts,PostgresStore,schemaSql} from '../apps/api/postgres.mjs';

test('Postgres persists identity, isolates creator records and atomically consumes one-time credentials',async()=>{
  const db=new PGlite();
  const accounts=new PostgresAccounts('postgresql://test:test@localhost/test','test-only-encryption-secret-abcdefghijklmnopqrstuvwxyz');
  await accounts.pool.end();
  const query=async(sql,params)=>{sql=schemaSql(sql);const result=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);return {...result,rowCount:result.affectedRows??result.rows?.length??0};};
  accounts.pool={query,connect:async()=>({query,release(){}}),end:()=>db.close()};
  try{
    await accounts.init();
    const alice=await accounts.register('alice@example.test','test-password-alice-123','Alice');
    const bob=await accounts.register('bob@example.test','test-password-bob-123','Bob');
    await assert.rejects(accounts.register('alice@example.test','test-password-alice-123','Alice'),{code:'ACCOUNT_EXISTS'});
    await assert.rejects(accounts.login('alice@example.test','wrong'),{code:'INVALID_LOGIN'});
    assert.equal((await accounts.login('alice@example.test','test-password-alice-123')).id,alice.id);
    const token=await accounts.startSession(alice.id);assert.equal((await accounts.findUser(token)).id,alice.id);
    const track=await accounts.track(alice.id,'aaaaaaaaaaa','growth tips','en');
    assert.equal((await accounts.tracks(bob.id)).length,0);assert.equal(await accounts.removeTrack(bob.id,track.id),false);
    await assert.rejects(accounts.checks(bob.id,track.id),{code:'NOT_FOUND'});
    await accounts.addCheck(alice.id,track.id,{position:3,found:true,checkedAt:new Date().toISOString()});assert.equal((await accounts.checks(alice.id,track.id))[0].position,3);
    const code=await accounts.newExtensionCode(alice.id),extension=await accounts.exchangeExtensionCode(code);assert.equal((await accounts.findUser(extension.token,'api')).id,alice.id);await assert.rejects(accounts.exchangeExtensionCode(code),{code:'CODE_EXPIRED'});
    const state=await accounts.state(alice.id);assert.equal(await accounts.redeemState(state),alice.id);await assert.rejects(accounts.redeemState(state),{code:'BAD_OAUTH_STATE'});
    await accounts.connectGoogle(alice.id,'test-refresh-token');assert.equal(await accounts.googleToken(alice.id),'test-refresh-token');assert.notEqual((await accounts.one('SELECT refresh_token_enc FROM integrations WHERE user_id=?',alice.id)).refresh_token_enc,'test-refresh-token');
    for(let i=0;i<5;i++)await accounts.useFeature(alice.id,'search');await assert.rejects(accounts.useFeature(alice.id,'search'),{code:'PLAN_LIMIT'});
    const store=await new PostgresStore(accounts).init();await Promise.all(Array.from({length:5},()=>store.mutate(s=>{s.counter=(s.counter||0)+1;})));const reopened=await new PostgresStore(accounts).init();assert.equal(reopened.state.counter,5);assert.equal(reopened.durable,true);
    await accounts.saveAnalytics(alice.id,'aaaaaaaaaaa',{points:[],source:'youtube_analytics_api'});await accounts.cleanup();
    await accounts.deleteAccount(alice.id);assert.equal(await accounts.findUser(token),null);assert.equal(await accounts.googleToken(alice.id),null);assert.equal((await accounts.tracks(bob.id)).length,0);
  }finally{await accounts.close();}
});
