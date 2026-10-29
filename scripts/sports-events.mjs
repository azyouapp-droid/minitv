const competitions = [
  ['4351', 'Brasileirão Série A'],
  ['4404', 'Brasileirão Série B'],
  ['4328', 'Premier League'],
  ['4335', 'La Liga'],
  ['4331', 'Bundesliga'],
  ['4332', 'Serie A Italiana'],
  ['4334', 'Ligue 1'],
  ['4480', 'Champions League'],
  ['5071', 'Conference League'],
  ['4725', 'Copa do Brasil']
];

let cache = { expires: 0, date: '', events: [] };

function brazilDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function loadCompetition(date, [id, name]) {
  const url = new URL(`https://www.thesportsdb.com/api/v1/json/123/eventsday.php`);
  url.searchParams.set('d', date);
  url.searchParams.set('l', id);
  const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`TheSportsDB ${response.status}`);
  const data = await response.json();
  return (Array.isArray(data.events) ? data.events : [])
    .filter(event => event.dateEvent === date && event.strHomeTeam && event.strAwayTeam)
    .map(event => ({
      id: event.idEvent,
      title: event.strEvent || `${event.strHomeTeam} x ${event.strAwayTeam}`,
      date: event.dateEvent,
      // O nome da liga vem da tabela local em PT-BR; o restante do evento
      // (partida, data e escudos) continua sendo carregado pela API diariamente.
      league: { name, image: event.strLeagueBadge || '' },
      teams: {
        home: { name: event.strHomeTeam, image: event.strHomeTeamBadge || '' },
        away: { name: event.strAwayTeam, image: event.strAwayTeamBadge || '' }
      }
    }));
}

async function loadBrazilianSchedule(date) {
  const url = new URL('https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard');
  url.searchParams.set('dates', date.replaceAll('-', ''));
  url.searchParams.set('limit', '100');
  const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error('Calendário brasileiro indisponível');
  const data = await response.json();
  return (Array.isArray(data.events) ? data.events : []).flatMap(event => {
    const matchDate = new Date(event.date);
    if (!Number.isFinite(matchDate.getTime()) || new Intl.DateTimeFormat('en-CA', { timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' }).format(matchDate) !== date) return [];
    const teams = event.competitions?.[0]?.competitors || [];
    const home = teams.find(team => team.homeAway === 'home')?.team;
    const away = teams.find(team => team.homeAway === 'away')?.team;
    if (!home?.displayName || !away?.displayName) return [];
    return [{ id:'espn-'+event.id, title:`${home.displayName} vs ${away.displayName}`, date,
      league:{ name:'Brasileirão Série A', image:data.leagues?.[0]?.logos?.[0]?.href || '' },
      teams:{ home:{name:home.displayName,image:home.logo || ''}, away:{name:away.displayName,image:away.logo || ''} } }];
  });
}

function teamKey(value) {
  const name = (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(football club|futebol clube|fc|cf|sc|afc|club)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  if (/^(atletico mineiro|atletico mg)$/.test(name)) return 'atletico mineiro';
  return name;
}

function matchKey(event) {
  return [teamKey(event.teams.home.name), teamKey(event.teams.away.name)].sort().join('|');
}

export async function getTodayEvents() {
  const date = brazilDate();
  if (cache.date === date && Date.now() < cache.expires) return cache.events;

  const results = await Promise.allSettled([...competitions.map(competition => loadCompetition(date, competition)), loadBrazilianSchedule(date)]);
  const events = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const byMatch = new Map();
  for (const event of events) if (!byMatch.has(matchKey(event))) byMatch.set(matchKey(event), event);
  const unique = [...byMatch.values()];
  unique.sort((a, b) => a.league.name.localeCompare(b.league.name, 'pt-BR') || a.title.localeCompare(b.title, 'pt-BR'));
  cache = { date, expires: Date.now() + 26 * 60 * 60 * 1000, events: unique };
  return unique;
}
