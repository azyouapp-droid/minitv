import test from 'node:test';
import assert from 'node:assert/strict';

test('loads all competitions once per day, includes late matches and retries failures', async () => {
  const originalFetch = globalThis.fetch;
  const date = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const next = new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  let calls=0,fail=true;
  globalThis.fetch = async input => {
    const url = new URL(input);
    calls++;
    assert.equal(url.hostname,'site.api.espn.com');
    assert.ok([date.replaceAll('-',''),next.replaceAll('-','')].includes(url.searchParams.get('dates')));
    if(fail && url.pathname.includes('/eng.1/')) return new Response('',{status:503});
    const make=(id,when)=>({id,date:when,competitions:[{competitors:[{homeAway:'home',team:{displayName:'Vasco da Gama',logo:'home'}},{homeAway:'away',team:{displayName:'Flamengo',logo:'away'}}]}]});
    return Response.json({leagues:[{logos:[{href:'league'}]}],events:url.pathname.includes('/bra.1/')?[make('one',next+'T01:30:00Z'),make('tomorrow',next+'T04:00:00Z')]:[]});
  };
  try {
    const {getTodayEvents}=await import('./sports-events.mjs?test-all-leagues');
    await assert.rejects(getTodayEvents());
    fail=false;
    const [events,simultaneous]=await Promise.all([getTodayEvents(),getTodayEvents()]);
    assert.equal(calls,44,'failed results are retried and concurrent requests share one refresh');
    assert.deepEqual(events,simultaneous);
    assert.equal(events.length,1,'select matches in the Brasília calendar day');
    assert.equal(events[0].title,'Vasco da Gama vs Flamengo');
    assert.equal(events[0].league.name,'Brasileirão Série A');
    assert.equal(events[0].league.image,'league');
    assert.equal((await getTodayEvents()).length,1);
    assert.equal(calls,44,'successful data is reused during the day');
  } finally {globalThis.fetch=originalFetch;}
});
