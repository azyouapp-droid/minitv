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

export async function getTodayEvents() {
  const date = brazilDate();
  if (cache.date === date && Date.now() < cache.expires) return cache.events;

  const results = await Promise.allSettled(competitions.map(competition => loadCompetition(date, competition)));
  const events = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const unique = [...new Map(events.map(event => [event.id, event])).values()];
  unique.sort((a, b) => a.league.name.localeCompare(b.league.name, 'pt-BR') || a.title.localeCompare(b.title, 'pt-BR'));
  cache = { date, expires: Date.now() + 26 * 60 * 60 * 1000, events: unique };
  return unique;
}
