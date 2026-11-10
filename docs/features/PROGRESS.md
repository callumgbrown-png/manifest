# 600-feature progress

One category at a time, each on its own branch `feature/600-<category>`, built from the module foundation on
`feature/600-features`. A category is done when every idea in `docs/features/assignments/<category>.txt` has a module,
`config/features/<category>.json` lists every module (economy ones false), `server/test/features-<category>.test.ts`
passes, and `docs/features/reports/<category>.md` exists.

| # | Category | Ideas | Status |
| --- | --- | --- | --- |
| 1 | ships | 40 | DONE 2026-11-10 (23 modules, 18 tests) |
| 2 | ports | 40 | DONE 2026-11-10 (34 modules, 33 tests) |
| 3 | world | 55 | DONE 2026-11-10 (33 modules, 31 tests) |
| 4 | economy | 60 | WIP snapshot only |
| 5 | contracts | 55 | WIP snapshot only |
| 6 | progression | 55 | WIP snapshot only |
| 7 | ui | 55 | WIP snapshot only |
| 8 | art | 52 | WIP snapshot only |
| 9 | platform | 55 | WIP snapshot only |
| 10 | community | 73 | WIP snapshot only |
| 11 | social | 60 | not started |

After all eleven: merge every category branch into `feature/600-features`, run the whole suite, write `FINAL_REPORT.md`.
