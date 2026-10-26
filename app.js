// SportsBot UI — fetches ESPN data in the browser and renders upset picks.
const API = "https://site.api.espn.com/apis/site/v2/sports/";
const state = { games: [], weeks: { nfl: null, ncaa: null }, offset: 0, league: "all", view: "picks", day: "week", loading: false };

// Local calendar date, e.g. "2026-10-26"
function dayKey(d) {
  d = new Date(d);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const $ = s => document.querySelector(s);

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } }
  }));
  return out;
}

async function loadLeague(key) {
  const L = LEAGUES[key];
  let url = `${API}${L.path}/scoreboard?${L.extra}`;
  const w = state.weeks[key];
  if (state.offset && w) {
    const week = w.number + state.offset;
    if (week < 1) return [];
    url += `${L.extra ? "&" : ""}week=${week}&seasontype=${w.seasonType}`;
  }
  const data = await getJSON(url);
  if (!state.offset) state.weeks[key] = { number: data.week?.number || 1, seasonType: data.season?.type || 2 };
  const games = (data.events || []).map(e => parseEvent(e, key)).filter(Boolean);

  // FPI predictor + backup odds live on each game's summary
  await pool(games, 8, async g => {
    const s = await getJSON(`${API}${L.path}/summary?event=${g.id}`);
    g.fpi = parsePredictor(s);
    if (!g.odds && s.pickcenter?.length) g.odds = parseOdds(s.pickcenter[0], g.home, g.away);
  });
  return games;
}

async function load() {
  if (state.loading) return;
  state.loading = true;
  $("#status").textContent = "Scanning every NFL and FBS game…";
  $("#list").innerHTML = "";
  try {
    const keys = state.league === "all" ? ["nfl", "ncaa"] : [state.league];
    const results = await Promise.allSettled(keys.map(loadLeague));
    state.games = results.flatMap(r => (r.status === "fulfilled" ? r.value : []));
    const failed = results.filter(r => r.status === "rejected");
    state.games.forEach(g => (g.a = analyze(g)));
    render();
    if (failed.length) $("#status").textContent += ` (couldn't load ${failed.length} league feed)`;
  } catch (e) {
    $("#status").textContent = "Couldn't reach ESPN: " + e.message;
  } finally { state.loading = false; }
}

function weekLabel() {
  const parts = [];
  for (const k of ["nfl", "ncaa"]) {
    if (state.league !== "all" && state.league !== k) continue;
    const w = state.weeks[k];
    if (w) parts.push(`${LEAGUES[k].label} Wk ${w.number + state.offset}`);
  }
  return parts.join(" · ") || "This week";
}

function render() {
  $("#week").textContent = weekLabel();
  const today = dayKey(Date.now());
  const inDay = g => state.day === "week" || dayKey(g.date) === today;
  let games = state.games.filter(g => g.a && inDay(g));
  const order = { strong: 0, watch: 1, longshot: 2, none: 3 };
  games.sort((x, y) => order[x.a.tier] - order[y.a.tier] || y.a.score - x.a.score);
  if (state.view === "picks") games = games.filter(g => g.a.tier !== "none");

  const all = state.games.filter(g => g.a && inDay(g));
  const picks = all.filter(g => g.a.tier === "strong" || g.a.tier === "watch");
  const done = picks.filter(g => g.a.result);
  const hits = done.filter(g => g.a.result === "upset").length;
  const allDone = all.filter(g => g.a.result), allUpsets = allDone.filter(g => g.a.result === "upset").length;

  $("#status").textContent =
    `${all.length} games scanned · ${all.filter(g => g.a.tier === "strong").length} strong alerts · ` +
    `${all.filter(g => g.a.tier === "watch").length} on watch` +
    (done.length ? ` · Picks hit ${hits}/${done.length}` : "") +
    (allDone.length ? ` · ${allUpsets} upsets so far` : "");

  let empty = "No upset alerts for this slate. Switch to “All games” to see every matchup.";
  if (state.day === "today" && !all.length) empty = "No games today. Switch to “All week” to see the full slate.";
  else if (state.day === "today") empty = "No upset alerts today. Switch to “All games” to see today's matchups.";
  $("#list").innerHTML = games.length ? games.map(card).join("") : `<p class="empty">${empty}</p>`;
}

const TIER = { strong: ["🔥 Upset alert", "strong"], watch: ["⚠️ Upset watch", "watch"], longshot: ["🎯 Long shot", "long"], none: ["Favorite holds", "none"] };

function teamRow(t, isDog, a) {
  const rk = t.rank ? `<span class="rk">#${t.rank}</span>` : "";
  const sc = t.score != null && a.g.state !== "pre" ? `<span class="sc">${t.score}</span>` : "";
  return `<div class="team ${isDog ? "dog" : ""}">
    ${t.logo ? `<img src="${t.logo}" alt="" loading="lazy">` : `<span class="ph"></span>`}
    <span class="tn">${rk}${esc(t.name)}</span><span class="rec">${esc(t.record)}</span>${sc}
  </div>`;
}

function card(g) {
  const a = g.a; a.g = g;
  const [label, cls] = TIER[a.tier];
  const when = g.state === "pre"
    ? new Date(g.date).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
    : g.statusText;
  let badge = "";
  if (a.live === "dog-leading") badge = `<span class="badge live">LIVE · ${esc(a.dog.short)} leads</span>`;
  else if (a.live === "tied") badge = `<span class="badge live">LIVE · tied</span>`;
  if (a.result === "upset") badge = `<span class="badge hit">UPSET ✓</span>`;
  else if (a.result === "chalk" && a.tier !== "none") badge = `<span class="badge miss">Favorite won</span>`;

  const line = g.odds?.details ? esc(g.odds.details) : "No line";
  return `<article class="card ${cls}">
    <header><span class="tier">${label}</span><span class="lg">${LEAGUES[g.league].label}</span>${badge}</header>
    ${teamRow(g.away, a.dogSide === "away", a)}
    ${teamRow(g.home, a.dogSide === "home", a)}
    <div class="meter" title="Upset chance"><div style="width:${Math.round(a.upsetProb * 100 / 0.6)}%"></div></div>
    <div class="nums">
      <div><b>${pct(a.upsetProb)}</b><small>Upset chance</small></div>
      <div><b>${pct(a.marketDog)}</b><small>Vegas</small></div>
      <div><b>${pct(a.fpiDog)}</b><small>ESPN FPI</small></div>
      <div><b>${a.score}</b><small>Score</small></div>
    </div>
    ${a.reasons.length ? `<ul>${a.reasons.slice(0, 4).map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
    <footer>${esc(when)} · ${line}${g.odds?.overUnder ? ` · O/U ${g.odds.overUnder}` : ""}${g.broadcast ? ` · ${esc(g.broadcast)}` : ""}${g.neutral ? " · Neutral" : ""}</footer>
  </article>`;
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function seg(id, key) {
  document.querySelectorAll(`#${id} button`).forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(`#${id} button`).forEach(x => x.classList.toggle("on", x === b));
    state[key] = b.dataset.v;
    key === "league" ? load() : render();
  }));
}

seg("leagueSeg", "league");
seg("viewSeg", "view");
seg("daySeg", "day");
$("#prev").onclick = () => { state.offset--; load(); };
$("#next").onclick = () => { state.offset++; load(); };
$("#refresh").onclick = load;
load();
setInterval(() => { if (state.games.some(g => g.state === "in")) load(); }, 120000);
