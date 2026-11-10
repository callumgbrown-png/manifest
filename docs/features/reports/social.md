# Social category report (ideas 111-130, 341-380)

All 60 ideas are built as 47 modules in `server/src/features/social/`, tested in `server/test/features-social.test.ts`
(33 tests, including a full replay of every module together). The client part is `server/public/features/social.js`
(a Social panel for anything that needs typed text, plus map marks for guild ports, HQs, formations, megaprojects
and signals). No shared core files were edited.

"Companies" in the ideas are **guilds** here: each player already runs a company, so a guild is a group of player
companies with ranks, a flag and shared activities. (The existing guild freight is an NPC cargo clearinghouse and is untouched.)

## Switched on (content)
| Module | Ideas | What it does |
| --- | --- | --- |
| social.guilds | 111, 349, 350 | Guilds: create (name + tag), invite or open joining, ranks (member/officer/leader), two-colour flag, leadership hand-over; 8 members (12 with Muster roll) |
| social.guild-chat | 358 | Members-only chat, filtered, last 50 messages |
| social.recruitment | 359 | Recruitment board: officers post a pitch, players apply, accepted applicants get an invite |
| social.guild-hq | 341, 342 | HQ port (moves once per 72 h); guild shipyard lets members build at the HQ at the normal price |
| social.guild-ports | 115 | A guild holds a port when its members delivered the most there in 3 days (at least 300 t); flag on the map |
| social.guild-contests | 116 | Weekly guild contest with a rotating theme; winners go to the hall of fame |
| social.guild-missions | 352, 355 | Daily guild mission (deliver a good to a port) for guild XP; tech tree bought with XP (roster, shared charts, signal book, archives, heraldry) with no economy effects |
| social.formations | 353 | Guildmates leaving the same port for the same port in the same hour sail as a formation: shown on the map, earns XP |
| social.shared-fleets | 112 | Lend a docked, empty ship to a guildmate for 1-72 h; it returns once docked and empty; late returns cost trust |
| social.hall-of-fame | 360 | Season records (biggest delivery, biggest guild, most XP) and each guild's honours |
| social.reputation | 129, 356 | Trust score 0-100 (trades, punctual lines, verdicts, mentoring, late loans, ratings after a trade); guild reputation |
| social.trade-window | 117 | Ship-to-ship cargo sale between two companies in the same port at an agreed price |
| social.auctions | 118 | Ship auctions (24 h, reserve 25-300% of new price, held bids, anti-sniping) |
| social.friends | 121, 122 | Friend requests and visits to friends' fleets |
| social.mentors | 123 | Captains with 15+ voyages mentor new ones; mentor points and trust at the mentee's 3/10/25 voyages |
| social.megaprojects | 126 | The Great Canal and the Grand Lighthouse, built from donated cargo (the cargo is used up); contributor board |
| social.shipping-lines | 127 | Published timetables for a ship between two ports; punctuality score |
| social.ledger | 379 | Public ledger of player-to-player money moves and civic events |
| social.whistleblower | 380 | Confidential reports; three different reporters open a public investigation notice; reporters never shown |
| social.mayors | 361 | Weekly mayor election per port by companies based there; mayors set a port motto, propose laws, issue licences |
| social.laws | 363, 364 | Weekly 5-seat server council; council and mayors propose laws from a fixed list; everyone votes for 48 h |
| social.courts | 367, 368 | Court (3 random trusted judges) and arbitration (1 judge); verdicts change trust only |
| social.licences | 370, 371 | Mayors issue licences at their port; the council appoints up to 5 inspectors who inspect docked ships |
| social.newspapers | 373 | Player newspapers: filtered stories, likes, a public front page |
| social.polls | 375, 377, 378 | Weekly votes on a map change, the next feature and a fun question; results kept for the developers |

## Switched off until Dave approves (economy)
The assignment flags some of these as economy even though they move no money (regional chat, signals, spectator,
news feed, alliances, rivalries, roles, mergers); they follow the assignment and can be switched on freely.

| Module | Ideas | What it changes |
| --- | --- | --- |
| social.treasury | 113, 344 | Guild treasury deposits and withdrawals; dividends split equally |
| social.roles | 114 | Per-guild minimum rank for withdraw, lend, dividend, contract, warehouse and war |
| social.bank | 343 | Loans from the treasury (up to half), 5% interest, collected after 7 days |
| social.shares | 345, 346, 347 | 100 shares per guild traded for cash; a majority holder can take over; mergers when both leaders agree |
| social.guild-contracts | 348 | Officers post deliveries paid from the treasury |
| social.warehouse | 354 | Store and take cargo at the guild HQ |
| social.wars | 357 | 3-day wars scored by tonnes delivered; the loser's treasury pays a 5% tribute |
| social.alliances | 124 | Guild alliances (both leaders agree) |
| social.rivalries | 125 | Head-to-head stats with a named rival |
| social.regional-chat | 119 | Chat per sea region for companies with a ship there |
| social.signals | 120 | Fixed signals and emotes over a ship for 3 h |
| social.spectator | 130 | Follow another company's ships; spectator counts |
| social.news-feed | 351 | Automatic guild feed of members' big deliveries |
| social.hire-captains | 128 | Daily wage to another player who may sail and sell for your ship (with your cash) |
| social.tax-votes | 362 | Mayor proposes -2..+2 points of trade tax at their port; residents vote |
| social.piracy-laws | 365 | Council outlaws piracy at a port: pirate ships pay a 500 fine on docking |
| social.treaties | 366 | Treaty guilds' members pay half the port fee at each other's HQ |
| social.fines | 369 | After a guilty verdict the plaintiff may claim 2% of the guilty company's cash (max 5,000) |
| social.lighthouse-taxes | 372 | A guild holding a port charges others +50 port fee there, paid into its treasury |
| social.naming-auctions | 374 | Weekly auction of a port's honorary name; proceeds to the community fund |
| social.community-fund | 376 | Donations; the council grants up to 2,000 once per company |
| social.megaproject-effects | 126 | A finished canal cuts sailing time 10% on lanes touching its port |

## Decisions
- **Split like ships:** megaprojects (126, ON) build and celebrate; the canal's travel-time saving is
  `social.megaproject-effects` (off).
- **Shared fleets, the trade window and auctions are on** although money or ships move: money only passes between
  two players at a price they choose (auction reserves within 25-300% of the new price) and nothing is created. A
  loaned ship's upkeep is paid by whoever holds it. Easy to switch off in `config/features/social.json`.
- **The guild shipyard charges the normal ship price**, so it changes where you can buy, not what it costs.
- **Laws, licences and verdicts are honours, not rules the engine enforces:** they move trust and appear on the
  public ledger; money penalties are only in `social.fines` (off).
- **No personal data:** player text is length-limited and filtered (`config/content/social/words.json`), and links,
  e-mail addresses, @handles and phone-like numbers are replaced with "[removed]". Whistleblower reporters are never published.
- **TypeScript transform caveat:** a regex literal containing ` ` was turned into a raw line separator by Node's
  type stripping and broke parsing; the separator pattern is now built from a string.
- Four existing test files need the `ws` package and could not be run in the cloud session; run `npm test` locally.
