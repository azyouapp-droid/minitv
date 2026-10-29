import test from 'node:test';
import assert from 'node:assert/strict';

test('supplementary schedule adds missing matches and avoids duplicates', async () => {
  const originalFetch = globalThis.fetch;
  const date = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'www.thesportsdb.com') {
      return Response.json({events: url.searchParams.get('l') === '4351' ? [{idEvent:'1',dateEvent:date,strHomeTeam:'Atlético Mineiro',strAwayTeam:'Cruzeiro',strEvent:'Atlético Mineiro vs Cruzeiro'}] : []});
    }
    assert.equal(url.hostname, 'site.api.espn.com');
    const make = (id, home, away) => ({id,date:date+'T23:00:00Z',competitions:[{competitors:[{homeAway:'home',team:{displayName:home,logo:'home-logo'}},{homeAway:'away',team:{displayName:away,logo:'away-logo'}}]}]});
    return Response.json({leagues:[{logos:[{href:'league-logo'}]}],events:[make('1','Atlético-MG','Cruzeiro'),make('2','Vasco da Gama','Flamengo')]});
  };
  try {
    const {getTodayEvents} = await import('./sports-events.mjs?test-supplement');
    const events = await getTodayEvents();
    assert.equal(events.length, 2);
    const match = events.find(event => event.title.includes('Flamengo'));
    assert.equal(match.date, date);
    assert.equal(match.teams.home.name, 'Vasco da Gama');
    assert.equal(match.league.image, 'league-logo');
  } finally { globalThis.fetch = originalFetch; }
});
