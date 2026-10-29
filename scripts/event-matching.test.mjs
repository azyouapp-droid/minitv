import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const parse=html.slice(html.indexOf('    function parseMatchChannel'),html.indexOf('    function leagueNamePtBr'));
const match=html.slice(html.indexOf('    function eventChannelFor'),html.indexOf('    function eventPlaybackChannel'));
function resolve(event,channels) {
  return vm.runInNewContext(parse+match+'\neventChannelFor(event)',{event,channels});
}
const event=(home,away)=>({teams:{home:{name:home},away:{name:away}}});
const channel=name=>({name:`(01) ⏰ 20:00 • ${name} •`,stream:'/stream'});

test('matches both teams, known aliases and distinctive name variants',()=>{
  assert.equal(resolve(event('Grêmio','Athletico-PR'),[channel('Grêmio x Athletico Paranaense')]).stream,'/stream');
  assert.equal(resolve(event('Vasco da Gama','Flamengo'),[channel('Vasco x Flamengo')]).stream,'/stream');
  assert.equal(resolve(event('Everton','Newcastle United'),[channel('Newcastle United x Everton')]).stream,'/stream');
});

test('refuses ambiguous games, youth variants and unrelated opponents',()=>{
  assert.equal(resolve(event('Vasco','Flamengo'),[channel('Vasco Sub 20 x Flamengo')]),null);
  assert.equal(resolve(event('Vasco da Gama','Flamengo'),[channel('Vasco Feminino x Flamengo')]),null);
  assert.equal(resolve(event('Vasco','Flamengo'),[channel('Cruzeiro x Flamengo')]),null);
  assert.equal(resolve(event('Vasco da Gama','Flamengo'),[channel('Vasco RJ x Flamengo'),channel('Vasco AC x Flamengo')]),null);
});
