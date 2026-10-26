# SportsBot 🏈

Scans every NFL and NCAA FBS football game for the week and flags likely upsets.

## How it picks upsets
For each game it finds the underdog, then blends:
- **Vegas** – win chance implied by the moneyline (vig removed), or by the spread if there's no moneyline
- **ESPN FPI** – ESPN's own matchup projection
- **Situational nudges** – home underdog, ranked favorite on the road, dog with an equal/better record, higher-ranked dog, low game total

Tiers:
- 🔥 **Upset alert** – ≥45% upset chance, or ≥38% when FPI likes the dog 6+ points more than Vegas
- ⚠️ **Upset watch** – ≥38%, or ≥30% with that FPI edge
- 🎯 **Long shot** – ≥28%

Live games show when the dog is leading, and finished games show whether the pick hit, with a running hit rate at the top.

## Use it
It's a static site — no server or API key. Turn on **GitHub Pages** (Settings → Pages → Deploy from branch → `main` / root), then open
`https://keubanks16.github.io/SportsBot/` and use **Add to Home Screen** on your phone.

Use ‹ › to step through weeks. It auto-refreshes every 2 minutes while games are live.

## Files
- `upset.js` – the prediction engine
- `app.js` – fetches ESPN data and draws the cards
- `index.html`, `style.css` – the page
- `test.js` – `node test.js` runs sanity checks

For entertainment only — not betting advice.
