# Pre-deploy checklist (ideas 582, 590)

Run through this before merging a branch into `main` or restarting the live server on new code.

## Automatic (one command)

From `server/`:

```
npx tsx ../tools/platform/predeploy.ts
```

It fails if any of these fail:

1. **Determinism self-test**: a fixed 48-hour scenario is run twice in fresh engines on the configured map; the two
   world digests must match and the world must pass every invariant (prices in bands, no negative cargo, every ship
   in exactly one fleet). The live server runs the same check once a game day (`platform.self-test`, shown in the
   admin console).
2. **Switch files**: every feature module has a line in `config/features/*.json`, no line names a missing module,
   and no economy module is switched on (those need Dave's approval).
3. **Test suite**: `npm test` (automated regression tests for the engine and every feature category).

## By hand

- [ ] `git log main..HEAD` reads sensibly; no stray debug code or `Date.now()` / `Math.random()` in `server/src/features/`.
- [ ] Any change to `engine.ts`, `main.ts`, `app.js`, `registry.ts` or `types.ts` is listed in the category report.
- [ ] Back up the save first: `npx tsx ../tools/platform/backup.ts`.
- [ ] Replay the live save on the new code and compare with the admin console's latest checkpoint:
      `npx tsx ../tools/platform/replay.ts --tick <latest checkpoint tick>` should print the same
      `platform.checkpoints` digest. If it differs, the new code changes old worlds: do not deploy mid-season.
- [ ] Run a persona simulation for balance: `npx tsx ../sim/personas.ts --days 7` and read the report
      (no persona far ahead of the others, health score not falling, Gini under 0.6).
- [ ] Open the game in a browser: log in, sail, trade, check the Opportunities tab and the admin page.
- [ ] After deploying, watch the admin console's health score, alerts and self-test for an hour.

## If something goes wrong

- Roll back the code (`git revert`), restart.
- If the world itself is damaged, stop the server and roll the save back to the last good checkpoint:
  `npx tsx ../tools/platform/rollback.ts --tick <hour> --expect <digest>` writes a new save file
  (the original is never changed); start the server with `DB_PATH=<new file>`.
