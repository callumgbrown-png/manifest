# Community category report (ideas 173-195, 501-550)

All 73 ideas are covered. 31 in-game ideas are built as 13 modules in `server/src/features/community/`, tested in
`server/test/features-community.test.ts` (16 tests, including a full replay of every module together). The other 42
ideas happen outside the game; they are ready-to-use documents in `docs/community/` (index: `docs/community/README.md`;
the test checks every idea has a module or a document). The client part is `server/public/features/community.js`
(Community panel, map cosmetics, horn sounds, share card); the signed-out stats page is
`server/public/features/community-stats.html`; unlock codes are made with `tools/community/make-codes.mjs`.
No shared core files were edited.

## Switched on (content)
| Module | Ideas | What it does |
| --- | --- | --- |
| community.locker | 173, 174, 179, 180, 501-508 | Cosmetic locker: ship skins, hull patterns, funnels, company flags and logos, port banners, crane skins, name plates, wakes, horns, badges (89 items, 10 packs in `config/content/community/cosmetics.json`). Owning the existing company pennant unlocks the Admiralty flag and funnel. Looks are public and drawn on the map |
| community.codes | 176, 181, 184, 510, 512, 513 | Unlock codes for things sold or given away outside the game (supporter badge, soundtrack extras, race prizes, founder pack, charity skin, playtester skin). Only a hash of the code is sent; only salted hashes are stored; use limits; 5 wrong tries a day |
| community.seasonal | 509, 511 | Seasonal skins free to claim during their days; limited runs for the first N companies |
| community.dedications | 183 | Port dedication tokens (from codes, e.g. early Discord testers) name a quay at a port for the season |
| community.share-fleet | 188 | Own-company snapshot drawn as a PNG card to download or copy |
| community.stats | 189 | Public season stats every 6 h (companies, ships, deliveries, tonnes, busiest ports, top 10), also on a signed-out page |
| community.speedruns | 194 | Four timed challenges, public best times, cosmetic rewards (gold wake for beating par) |
| community.testers | 534, 535 | Structured in-game bug reports (kind and port, no free text, 3 a day); tester points from codes unlock bug-hunter cosmetics; public tester board |
| community.referrals | 536 | Invite tags; a referral counts after the new company finishes 3 voyages; cosmetic rewards at 1/2/3/5 |
| community.wiki | 546 | In-game wiki: port, good, ship and guide pages built from live data, plus filtered player tips with votes and flags |
| community.links | 177, 178, 181, 182, 193 | Community links from `config/links.json` (itch.io, tip jar, soundtrack, sprite packs, Discord…); empty ones hidden |

## Switched off until Dave approves (economy)
| Module | Ideas | What it changes |
| --- | --- | --- |
| community.shop | 173, 179, 180, 501-508 | Buy cosmetics and packs with in-game credits (a money sink; prices 250-1,200 in cosmetics.json) |
| community.naming | 175 | Pay 5,000 credits to dedicate a port quay or 750 to put a name on a ship's public nameboard |

## Outside the game (docs/community/)
itch.io page, pay-what-you-want download and devlog (177, 193, 542) · tip jar, sprite packs, soundtrack, PDF book,
wallpapers, stickers, posters, commissions (178, 182, 514-519) · Discord naming rewards, races, announcements, Q&A,
roadmap voting, playtest weekends (183, 184, 190, 522, 523, 533) · devlog series, sprite clips, player stories,
changelogs, patch-note videos, pixel-art process and tutorials (185-187, 520, 524, 525, 531) · five Shorts scripts
(526-530) · Reddit, portals, subreddit, streamers, game jam, showcases, Show HN, Product Hunt, cross-promotion (191,
192, 521, 532, 540, 541, 543-545) · press kit, trailer shot list, GIF library (537-539) · map, fan art, ship and lore
contests and the meme template (195, 547-550) · wiki starter articles (546).

## Decisions
- **Assignment said ON, but money moves:** cosmetics (173, 179, 180, 501-508) are on and obtainable for free, from
  seasons, challenges, testing, referrals and codes; buying them with credits is split into `community.shop` (off).
- **No real money in the game.** Paid items are sold on outside shops; buyers get a code. Codes stay out of the event
  log (the browser sends a SHA-256 "proof"; `codes.json` stores salted hashes). `codes.json` ships empty: Dave makes codes with
  `make-codes.mjs`. Don't edit or delete code entries or catalogue ids mid-season, because the event log replays against them.
- **Bug reports carry no free text** (kind, optional port/ship) to keep personal data out; the platform category's
  bug-report module has the text box. Tester points arrive only through codes, so Dave confirms each report.
- **Referral tags** are a fixed hash of the company id: not secret, nothing personal. A referral counts only after
  the new company finishes 3 voyages, and two companies can't refer each other.
- **Wiki tips** are filtered (no links, e-mail-like text, long digit strings or blocked words), capped at 3 a day and 300
  overall, and hidden after 3 flags.
- **Public stats page** is a static file that opens the existing websocket without signing in, so `main.ts` was not changed.
- Cosmetic colours and shapes are placeholders drawn in code until Dave draws real sprites.
- Four existing test files need the `ws` package and could not be run in the cloud session; run `npm test` locally.
