const competitions = [
  ['bra.1', 'Brasileirão Série A'],
  ['bra.2', 'Brasileirão Série B'],
  ['eng.1', 'Premier League'],
  ['eng.league_cup', 'Copa da Liga Inglesa'],
  ['esp.1', 'La Liga'],
  ['ger.1', 'Bundesliga'],
  ['ita.1', 'Serie A Italiana'],
  ['fra.1', 'Ligue 1'],
  ['uefa.champions', 'Champions League'],
  ['uefa.europa.conf', 'Conference League'],
  ['bra.copa_do_brazil', 'Copa do Brasil']
];

let cache = { date: '', events: [] };
let pending = null;
const brazilDay = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});

async function loadCompetition(date, [id, name]) {
  const next = new Date(Date.parse(date+'T00:00:00Z') + 86400000).toISOString().slice(0,10);
  const days = await Promise.all([date,next].map(async day => {
    const url = new URL(`https://site.api.espn.com/apis/site/v2/sports/soccer/${id}/scoreboard`);
    url.searchParams.set('dates',day.replaceAll('-',''));
    url.searchParams.set('limit','100');
    const response = await fetch(url,{signal:AbortSignal.timeout(9000)});
    if (!response.ok) throw new Error(`Calendário indisponível (${id})`);
    const data=await response.json();
    if (!Array.isArray(data.events)) throw new Error(`Calendário inválido (${id})`);
    return data;
  }));
  return days.flatMap(data => data.events.flatMap(event => {
    const matchDate = new Date(event.date);
    if (!Number.isFinite(matchDate.getTime()) || brazilDay.format(matchDate) !== date) return [];
    const competitors = event.competitions?.[0]?.competitors || [];
    const home = competitors.find(team => team.homeAway === 'home')?.team;
    const away = competitors.find(team => team.homeAway === 'away')?.team;
    if (!event.id || !home?.displayName || !away?.displayName) return [];
    return [{id:`espn-${event.id}`, title:`${home.displayName} vs ${away.displayName}`, date,
      league:{name, image:data.leagues?.[0]?.logos?.[0]?.href || ''},
      teams:{home:{name:home.displayName,image:home.logo || ''},away:{name:away.displayName,image:away.logo || ''}}}];
  }));
}

export async function getTodayEvents() {
  const date = brazilDay.format(new Date());
  if (cache.date === date) return cache.events;
  if (!pending || pending.date !== date) {
    const promise = Promise.all(competitions.map(competition => loadCompetition(date, competition)))
      .then(results => {
        const unique = [...new Map(results.flat().map(event => [event.id,event])).values()];
        unique.sort((a,b) => a.league.name.localeCompare(b.league.name,'pt-BR') || a.title.localeCompare(b.title,'pt-BR'));
        cache = {date,events:unique};
        return unique;
      }).finally(() => { if (pending?.promise === promise) pending = null; });
    pending = {date,promise};
  }
  return pending.promise;
}
