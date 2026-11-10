# itch.io (ideas 177, 193, 542)

## Page setup (193)
- **Title:** Manifest
- **Short description (tagline):** Buy low, sail far, sell high: a pixel-art shipping trade game you play in the browser.
- **Classification:** Game · Released (or In development) · Genre: Strategy, Simulation · Tags: trading, economy, pixel-art, multiplayer, browser, ships, idle, management
- **Kind of project:** HTML (embed `[GAME LINK]` in an iframe 1280x800, "Click to launch in fullscreen" on) or a link to the hosted game.
- **Cover image:** 630x500, harbour scene with three ships and the logo. **Screenshots:** map with lanes, a trade card, the leaderboard, a cosmetic ship, the stats page.
- **Community:** Comments on. Link Discord `[DISCORD]`.

### Page text
> **Manifest** is a shared-world shipping game. Every company starts with one freighter and a little cash in a busy
> archipelago. Buy grain where farms overflow, sail it where bakeries are short, and watch the price move as you sell.
> Every player's trades move the same markets.
>
> - 40 ports, four goods, three ship classes
> - Seasons that last a few weeks, with a leaderboard
> - Pirates, police, buy and sell orders, convoys
> - Cosmetics that only change looks, never stats
>
> Free to play in your browser. If you enjoy it, the pay-what-you-want download below comes with the Download edition
> flag and teal wake for your company.

## Pay-what-you-want download (177)
- Pricing: "No payments" off → **"$0 or donate"** with a suggested price of $3.
- Upload: a zip with the offline single-player build (or a "supporter" text file if there is no offline build yet) plus `UNLOCK.txt`.
- In **Distribute → External keys**, paste a batch of codes made with:
  `node tools/community/make-codes.mjs --grant pack:pack.download --count 200 --label itch-download`
  itch.io gives one code to each buyer. Set `itchPayWhatYouWant` in `config/links.json`.
- `UNLOCK.txt`: "Thanks for supporting Manifest! Open the game, click Community → Codes and enter your code to unlock the Download edition flag and teal wake."

## itch.io devlog (542)
Post every two weeks, cross-post the matching Discord announcement.

Template:
```
# Devlog [N]: [headline, e.g. "Pirates now steal half, not all"]
**What changed:** 3 bullet points, player-facing.
**Why:** one paragraph on the design reason.
**Numbers:** one fact from the public stats page (deliveries this week, busiest port).
**Art corner:** one GIF (before/after sprite).
**Next:** what is planned, with a link to roadmap voting.
Play: [GAME LINK] · Discord: [DISCORD]
```
