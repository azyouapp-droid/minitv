import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.split('// BEGIN media recovery helper')[1]?.split('// END media recovery helper')[0];
assert.ok(source,'player recovery helper must be present');

function fixture() {
  let now=1000000, pending=new Map(), serial=0, current=true, recovered=0, resumed=0, failed=0;
  const context={Date:{now:()=>now},setTimeout:fn=>{const id=++serial;pending.set(id,fn);return id;},clearTimeout:id=>pending.delete(id)};
  const create=vm.runInNewContext(source+'\ncreateMediaErrorRecovery',context);
  const video={error:{code:3}};
  const recovery=create({video,getHls:()=>({recoverMediaError:()=>recovered++}),isCurrent:()=>current,resume:()=>resumed++,fail:()=>failed++});
  return {recovery,video,advance:ms=>now+=ms,changeChannel:()=>current=false,fireTimeouts:()=>{for(const fn of [...pending.values()])fn();},state:()=>({recovered,resumed,failed,timers:pending.size})};
}

test('resumes after a fatal decoding error without reloading the page',()=>{
  const f=fixture();
  assert.equal(f.recovery.attempt(),true);
  assert.equal(f.recovery.attempt(),true,'duplicate fatal events must not reset playback again');
  f.recovery.ready();f.recovery.ready();
  assert.equal(f.state().resumed,1);
  f.recovery.playing();f.fireTimeouts();
  assert.deepEqual(f.state(),{recovered:1,resumed:1,failed:0,timers:0});
});

test('stops failed recovery and does not affect a newly selected channel',()=>{
  const f=fixture();f.recovery.attempt();f.fireTimeouts();
  assert.equal(f.state().failed,1);
  const next=fixture();next.recovery.attempt();next.changeChannel();next.recovery.cleanup();next.recovery.ready();next.fireTimeouts();
  assert.deepEqual(next.state(),{recovered:1,resumed:0,failed:0,timers:0});
});

test('limits repeated recovery attempts and allows later isolated failures',()=>{
  const f=fixture();
  f.video.error=null;assert.equal(f.recovery.attempt(),false);
  f.video.error={code:3};
  f.recovery.attempt();f.recovery.playing();f.recovery.attempt();f.recovery.playing();
  assert.equal(f.recovery.attempt(),false);
  f.advance(300001);assert.equal(f.recovery.attempt(),true);
});
