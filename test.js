// Run: node test.js — sanity checks for the upset engine using ESPN-shaped data.
const U = require("./upset.js");
const assert = require("assert");

const comp = (home, away, odds, extra = {}) => ({
  id: extra.id || "1", date: "2026-11-01T17:00Z", shortName: `${away.abbr} @ ${home.abbr}`,
  competitions: [{
    neutralSite: false, status: { type: { state: extra.state || "pre", shortDetail: "" } },
    competitors: [
      { homeAway: "home", score: extra.hs, team: { id: "h", displayName: home.name, abbreviation: home.abbr }, records: [{ type: "total", summary: home.rec }], curatedRank: { current: home.rank || 99 } },
      { homeAway: "away", score: extra.as, team: { id: "a", displayName: away.name, abbreviation: away.abbr }, records: [{ type: "total", summary: away.rec }], curatedRank: { current: away.rank || 99 } },
    ],
    odds: odds ? [odds] : [],
  }],
});

// 1. Home dog with FPI disagreeing with Vegas → strong alert
let g = U.parseEvent(comp({ name: "Home Dogs", abbr: "HD", rec: "5-2" }, { name: "Road Favs", abbr: "RF", rec: "5-2", rank: 8 },
  { details: "RF -2.5", spread: 2.5, overUnder: 44.5, homeTeamOdds: { moneyLine: 120 }, awayTeamOdds: { moneyLine: -140, favorite: true } }), "ncaa");
g.fpi = U.parsePredictor({ predictor: { homeTeam: { gameProjection: "52.1" }, awayTeam: { gameProjection: "47.9" } } });
let a = U.analyze(g);
assert.strictEqual(a.dogSide, "home");
assert.strictEqual(g.odds.spread, 2.5);
assert.ok(a.upsetProb > 0.45, a.upsetProb);
assert.strictEqual(a.tier, "strong");
console.log("✓ home dog strong alert", U.pct(a.upsetProb), a.score, a.reasons);

// 2. Big favorite → no alert
g = U.parseEvent(comp({ name: "Juggernaut", abbr: "JG", rec: "7-0", rank: 1 }, { name: "Cupcake", abbr: "CC", rec: "2-5" },
  { details: "JG -27.5", spread: -27.5, homeTeamOdds: { moneyLine: -5000, favorite: true }, awayTeamOdds: { moneyLine: 1800 } }), "ncaa");
a = U.analyze(g);
assert.strictEqual(a.dogSide, "away");
assert.strictEqual(a.tier, "none");
console.log("✓ blowout ignored", U.pct(a.upsetProb));

// 3. Spread only (no moneylines), NFL
g = U.parseEvent(comp({ name: "Home", abbr: "HOM", rec: "3-4" }, { name: "Away", abbr: "AWY", rec: "4-3" },
  { details: "HOM -3", overUnder: 38.5 }), "nfl");
a = U.analyze(g);
assert.strictEqual(a.dogSide, "away");
assert.ok(a.marketDog > 0.38 && a.marketDog < 0.45, a.marketDog);
assert.strictEqual(a.marketSrc, "spread");
console.log("✓ spread-only NFL", U.pct(a.marketDog), a.tier);

// 4. Final: underdog won → result upset
g = U.parseEvent(comp({ name: "Home", abbr: "HOM", rec: "3-4" }, { name: "Away", abbr: "AWY", rec: "4-3" },
  { details: "HOM -6.5" }, { state: "post", hs: "17", as: "24" }), "nfl");
a = U.analyze(g);
assert.strictEqual(a.result, "upset");
console.log("✓ final upset detected");

// 5. No odds, FPI only
g = U.parseEvent(comp({ name: "H", abbr: "H", rec: "4-4" }, { name: "A", abbr: "A", rec: "6-2" }, null), "ncaa");
g.fpi = 0.62;
a = U.analyze(g);
assert.strictEqual(a.dogSide, "away");
assert.ok(Math.abs(a.fpiDog - 0.38) < 1e-9);
console.log("✓ FPI-only game", U.pct(a.upsetProb), a.tier);

// 6. Nothing to go on → null
g = U.parseEvent(comp({ name: "H", abbr: "H", rec: "" }, { name: "A", abbr: "A", rec: "" }, null), "ncaa");
assert.strictEqual(U.analyze(g), null);
console.log("✓ unknown matchup skipped\nAll tests passed");
