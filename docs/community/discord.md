# Discord (ideas 183, 184, 190, 522, 523, 533)

Suggested channels: #announcements, #changelog, #general, #trading-tips, #bug-reports, #art, #events, #roadmap, #qa.

## Naming rewards for early testers (183)
Everyone who joined the Discord and played before `[DATE]` gets a **port dedication token**: they name a quay at a
port for a season ("Anna's Quay"), shown in the game. Make one code per tester and DM it:
`node tools/community/make-codes.mjs --grant naming:1 --grant pack:pack.playtester --count [N] --label early-testers`

Announcement:
> ⚓ **Thank you, early crew!** If you played before [DATE], check your DMs: you have a code for a port dedication token
> and the playtester pack. Redeem it in Community → Codes, then Community → Dedicate to name a quay for the season.

## Race events (184)
Weekly, Saturday 18:00 `[TIMEZONE]`, 2 hours. In-game, players start the **Five hundred tonnes** speedrun (Opportunities → Speedrun challenges) when the event opens; the speedrun board shows the times.
- Prizes (codes, DM'd): 1st `item:badge.race-winner` + `naming:1`; top 3 `item:badge.race-winner`; everyone who finishes gets a shout-out.
- `node tools/community/make-codes.mjs --grant item:badge.race-winner --grant naming:1 --label race-[WEEK]`
- Rules: one company per person; start the run during the window; times from the in-game board are final.

## Weekly announcement template (190)
```
**Manifest weekly — [DATE]**
🚢 **New:** [1-3 changes]
📈 **Market of the week:** [port] paid the most for [good]; [N] deliveries this week (stats page: [LINK])
🏁 **Race:** Saturday [TIME]: [challenge]
🗳️ **Roadmap vote** closes [DAY]: [LINK]
🎨 **Art:** [GIF]
```

## Weekly Q&A (522)
Thursdays, 30 minutes in a stage channel or text thread. Collect questions in #qa from Monday; answer the top-voted
5 first. Post a written summary in #changelog afterwards. Never promise dates; say "on the roadmap" or "not planned".

## Roadmap voting (523)
Monthly. Post 5 candidate features in #roadmap as separate messages; members react 👍. Top 2 go on the public roadmap
(`roadmap` link in links.json, e.g. a Trello or GitHub project board). Explain why when a winning feature can't be built
(economy balance, server cost).

## Playtest weekends (533)
Before each big update: Friday 18:00 to Sunday 22:00. Run a test server with `FEATURES=all`. Testers report bugs with
the in-game **Report a bug** card (kind and port; no free text) plus a #bug-reports thread. Confirmed reports earn tester points:
`node tools/community/make-codes.mjs --grant points:3 --label playtest-[DATE]-report-[N]`
1 point: Bug hunter I + tester plate · 5: Bug hunter II + barnacle hull · 15: Bug hunter III + lighthouse wake. The tester board is in Community → Boards.
