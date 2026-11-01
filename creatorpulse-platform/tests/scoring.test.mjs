import test from 'node:test';
import assert from 'node:assert/strict';
import {titleScore,viewsPerHour,outlierScore,engagementRate,median} from '../packages/shared/scoring.mjs';
test('title score bounded and transparent',()=>{const x=titleScore('How to Grow a YouTube Channel in Thirty Days','YouTube');assert.ok(x.score>=0&&x.score<=100);assert.equal(x.isPrediction,false);assert.equal(x.checks.length,6);});
test('statistical functions are guarded',()=>{assert.equal(viewsPerHour(200,'2020-01-01',new Date('2020-01-01T02:00:00Z').getTime()),100);assert.equal(outlierScore(200,100),2);assert.equal(outlierScore(5,0),null);assert.equal(engagementRate(10,5,100),15);assert.equal(median([4,1,2,3]),2.5);});
