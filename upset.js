// SportsBot upset engine — pure functions, no DOM. Used by app.js and test.js.
// Works on ESPN's public scoreboard + summary JSON.

const LEAGUES = {
  nfl:  { label: "NFL",  path: "football/nfl",             extra: "",                    sd: 13.5 },
  ncaa: { label: "NCAA", path: "football/college-football", extra: "groups=80&limit=300", sd: 16.0 },
};

// --- math helpers -----------------------------------------------------------
function normCdf(x) {
  // Abramowitz-Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function mlToProb(ml) {
  const n = Number(ml);
  if (!isFinite(n) || n === 0) return null;
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}

function num(v) {
  if (v == null) return null;
  if (typeof v === "object") v = v.american ?? v.odds ?? v.value ?? v.line;
  if (typeof v === "string") v = v.replace(/[^0-9.+-]/g, "");
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}

function recordPct(summary) {
  const m = /^(\d+)-(\d+)(?:-(\d+))?/.exec(summary || "");
  if (!m) return null;
  const w = +m[1], l = +m[2], t = +(m[3] || 0);
  const g = w + l + t;
  return g ? (w + t / 2) / g : null;
}

// --- parsing ----------------------------------------------------------------
function parseTeam(c) {
  const rec = (c.records || []).find(r => r.type === "total" || r.name === "overall") || (c.records || [])[0];
  const rank = c.curatedRank && c.curatedRank.current;
  return {
    id: c.team?.id,
    name: c.team?.displayName || c.team?.name || "?",
    short: c.team?.abbreviation || c.team?.shortDisplayName || "?",
    logo: c.team?.logo || (c.team?.logos && c.team.logos[0]?.href) || "",
    homeAway: c.homeAway,
    record: rec?.summary || "",
    pct: recordPct(rec?.summary),
    rank: rank && rank <= 25 ? rank : null,
    score: c.score != null && c.score !== "" ? Number(c.score) : null,
    winner: !!c.winner,
  };
}

// Pull the home team's spread (negative = home favored) and moneylines out of
// ESPN's odds object, which comes in several shapes depending on provider.
function parseOdds(o, home, away) {
  if (!o) return null;
  let homeML = num(o.homeTeamOdds?.moneyLine) ?? num(o.moneyline?.home?.close) ?? num(o.moneyline?.home?.open);
  let awayML = num(o.awayTeamOdds?.moneyLine) ?? num(o.moneyline?.away?.close) ?? num(o.moneyline?.away?.open);
  let spread = num(o.spread); // ESPN: home-team spread
  const details = o.details || "";

  // Determine favorite from details text, e.g. "KC -3.5" or "EVEN"
  let favSide = null;
  const dm = /^([A-Za-z0-9&.' ]+?)\s*(-\d+(?:\.\d+)?)$/.exec(details.trim());
  if (dm) {
    const ab = dm[1].trim().toUpperCase();
    const line = Math.abs(parseFloat(dm[2]));
    if (ab === home.short.toUpperCase()) { favSide = "home"; spread = -line; }
    else if (ab === away.short.toUpperCase()) { favSide = "away"; spread = line; }
  }
  if (!favSide) {
    if (o.homeTeamOdds?.favorite) favSide = "home";
    else if (o.awayTeamOdds?.favorite) favSide = "away";
    else if (spread != null && spread !== 0) favSide = spread < 0 ? "home" : "away";
    else if (homeML != null && awayML != null && homeML !== awayML) favSide = homeML < awayML ? "home" : "away";
  }
  if (spread != null && favSide) spread = favSide === "home" ? -Math.abs(spread) : Math.abs(spread);
  return { details, spread, homeML, awayML, overUnder: num(o.overUnder), favSide };
}

function parseEvent(ev, league) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const cs = comp.competitors || [];
  const hc = cs.find(c => c.homeAway === "home"), ac = cs.find(c => c.homeAway === "away");
  if (!hc || !ac) return null;
  const home = parseTeam(hc), away = parseTeam(ac);
  const st = comp.status?.type || ev.status?.type || {};
  return {
    id: ev.id, league, date: ev.date, name: ev.shortName || ev.name,
    neutral: !!comp.neutralSite,
    venue: comp.venue?.fullName || "",
    broadcast: (comp.broadcasts?.[0]?.names || [])[0] || "",
    state: st.state || "pre", // pre | in | post
    statusText: st.shortDetail || st.detail || "",
    home, away,
    odds: parseOdds((comp.odds || [])[0], home, away),
    fpi: null, // filled from summary predictor
  };
}

// ESPN summary "predictor": { homeTeam: { gameProjection, teamChanceLoss }, awayTeam: {...} }
function parsePredictor(summary) {
  const p = summary?.predictor;
  if (!p) return null;
  const h = num(p.homeTeam?.gameProjection), a = num(p.awayTeam?.gameProjection);
  if (h != null && h > 0) return h / 100;
  if (a != null && a > 0) return 1 - a / 100;
  const hl = num(p.homeTeam?.teamChanceLoss);
  if (hl != null) return 1 - hl / 100;
  return null;
}

// --- the model --------------------------------------------------------------
// Returns analysis with the underdog, market win prob, model win prob and an
// upset score 0-100. Null when there's no way to tell who the favorite is.
function analyze(g) {
  const sd = LEAGUES[g.league].sd;
  const o = g.odds;

  // 1) Market probability (home win)
  let marketHome = null, marketSrc = null;
  const ph = mlToProb(o?.homeML), pa = mlToProb(o?.awayML);
  if (ph != null && pa != null) { marketHome = ph / (ph + pa); marketSrc = "moneyline"; }
  else if (o?.spread != null) { marketHome = normCdf(-o.spread / sd); marketSrc = "spread"; }

  // 2) Model probability (ESPN FPI)
  const fpiHome = g.fpi;

  // Favorite: market first, then FPI, then rank, then record
  let favSide = o?.favSide || null;
  if (!favSide && marketHome != null) favSide = marketHome >= 0.5 ? "home" : "away";
  if (!favSide && fpiHome != null) favSide = fpiHome >= 0.5 ? "home" : "away";
  if (!favSide && (g.home.rank || g.away.rank)) {
    favSide = (g.home.rank || 99) < (g.away.rank || 99) ? "home" : "away";
  }
  if (!favSide) return null;

  const dogSide = favSide === "home" ? "away" : "home";
  const dog = g[dogSide], fav = g[favSide];
  const toDog = p => (p == null ? null : dogSide === "home" ? p : 1 - p);

  const marketDog = toDog(marketHome);
  const fpiDog = toDog(fpiHome);
  const base = fpiDog != null && marketDog != null ? 0.55 * fpiDog + 0.45 * marketDog
             : (fpiDog ?? marketDog);
  if (base == null) return null;

  // 3) Situational nudges (each a few percentage points)
  const reasons = [];
  let adj = 0;
  if (fpiDog != null && marketDog != null) {
    const edge = fpiDog - marketDog;
    if (edge >= 0.05) reasons.push(`ESPN FPI gives ${dog.short} ${pct(fpiDog)} vs ${pct(marketDog)} implied by Vegas`);
    if (edge <= -0.08) reasons.push(`FPI likes ${fav.short} even more than Vegas does`);
  }
  if (dogSide === "home" && !g.neutral) { adj += 0.02; reasons.push(`${dog.short} is a home underdog`); }
  if (fav.rank && dogSide === "home" && !g.neutral) { adj += 0.015; reasons.push(`#${fav.rank} ${fav.short} has to win on the road`); }
  if (dog.pct != null && fav.pct != null) {
    const diff = dog.pct - fav.pct;
    if (diff >= 0) { adj += 0.03; reasons.push(`${dog.short} (${dog.record}) has as good or better a record than ${fav.short} (${fav.record})`); }
    else if (diff > -0.15) { adj += 0.01; }
  }
  if (dog.rank && fav.rank && dog.rank < fav.rank) { adj += 0.02; reasons.push(`Underdog is ranked higher (#${dog.rank} vs #${fav.rank})`); }
  if (o?.spread != null && Math.abs(o.spread) <= 3) reasons.push(`Only a ${Math.abs(o.spread)}-point spread`);
  if (o?.overUnder != null && o.overUnder <= (g.league === "nfl" ? 40 : 45) && Math.abs(o.spread ?? 99) <= 7) {
    adj += 0.01; reasons.push(`Low total (${o.overUnder}) — fewer possessions favor the dog`);
  }

  const upsetProb = Math.max(0.01, Math.min(0.6, base + adj));
  // Score: probability scaled so a coin-flip ~ 100, plus a bonus for FPI disagreeing with Vegas
  const edgeBonus = fpiDog != null && marketDog != null ? Math.max(0, fpiDog - marketDog) * 150 : 0;
  const score = Math.round(Math.min(100, upsetProb * 200 * 0.85 + edgeBonus));

  // Tiers: a near coin-flip is only "watch" unless the model disagrees with Vegas
  const edge = fpiDog != null && marketDog != null ? fpiDog - marketDog : 0;
  let tier = "none";
  if (upsetProb >= 0.45 || (upsetProb >= 0.38 && edge >= 0.06)) tier = "strong";
  else if (upsetProb >= 0.38 || (upsetProb >= 0.30 && edge >= 0.06)) tier = "watch";
  else if (upsetProb >= 0.28) tier = "longshot";

  // Live / final outcomes
  let live = null;
  if (g.state === "in" && dog.score != null && fav.score != null) {
    if (dog.score > fav.score) live = "dog-leading";
    else if (dog.score === fav.score) live = "tied";
  }
  let result = null;
  if (g.state === "post" && dog.score != null && fav.score != null) {
    result = dog.score > fav.score ? "upset" : "chalk";
  }

  return { favSide, dogSide, dog, fav, marketDog, fpiDog, marketSrc, upsetProb, score, tier, reasons, live, result };
}

function pct(p) { return p == null ? "—" : Math.round(p * 100) + "%"; }

if (typeof module !== "undefined") {
  module.exports = { LEAGUES, normCdf, mlToProb, num, recordPct, parseEvent, parseOdds, parsePredictor, analyze, pct };
}
