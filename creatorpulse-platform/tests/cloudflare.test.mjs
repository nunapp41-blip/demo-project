import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{computeVph} from '../cloudflare/src/worker.mjs';
test('Cloudflare Worker reports missing D1 rather than false availability',async()=>{
  const r=await worker.fetch(new Request('https://test.example/api/status'),{});
  assert.equal(r.status,503);assert.equal((await r.json()).error.code,'D1_NOT_CONFIGURED');
});
test('Cloudflare Worker computes VPH only from two timestamped points',()=>{
 assert.equal(computeVph({views:100,collected_at:1000},{views:150,collected_at:4600}),50);
 assert.equal(computeVph({views:null,collected_at:1000},{views:150,collected_at:4600}),null);
 assert.equal(computeVph({views:120,collected_at:4600},{views:100,collected_at:1000}),null);
});
