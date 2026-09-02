# Security Phase S7 — Resource Exhaustion / DoS

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ + S1 ✅ + S2 ✅ + S3 ✅ + S4 ✅ + S5 ✅ + S6 ✅ (parsers done)
**Implemented:** `server/src/routes/repos.ts:563` `vcs/src/revwalk.rs:152` `server/src/routes/search.ts:7` `server/src/routes/ci.ts:302` + `s7-dos.test.ts` 7

---

## 1. Objective

Harden **only resource exhaustion** — bound CPU/RAM/FD/DB/concurrency for VCS graph walks, search, CI queue, request/response sizes.

Per operator: `huge request → huge repo → expensive diff/merge → concurrent VCS → queue flooding → bounded concurrency/timeouts/limits/backpressure/pagination`

---

## 2. Scope

**In scope:**
- `server/src/routes/repos.ts:558` `isAncestor` BFS `MAX_STEPS 5000` per `POST /refs/heads/*` + `POST /objects` + `push`
- `vcs/src/revwalk.rs:107` `walk_log` BFS `visited` + `queue` unbounded, `max_count` up to 200 but walk may traverse 10000s before truncate, `all_entries` sort, `commit_touches_paths` `flatten_tree` per commit
- `server/src/routes/search.ts:7` `q` any len, `limit 50`, `ILIKE %q%` sequential scan, no `statement_timeout`
- `server/src/routes/ci.ts:289` `POST /ci/run` no rate-limit, `runPipeline` `collectArtifacts` `execItehaas log --max-count 500` per repo (up to 5 concurrent via `Promise.all` in `users.ts` contributions)
- `server/src/routes/repos.ts:872` `max_count` 200 but `isAncestor` + `log` 200 each spawn `cat-file` many times → 100 concurrent `execItehaas` → FD exhaustion (S5 semaphore 3 partially mitigates, but S7 adds global bounds)
- Request body `POST /objects/:hash` 64M already, response `GET /objects/:hash` streaming (good), `GET /log` 200, `GET /search` 50

**Out of scope (other phases):**
- S4 FS `checkout` symlink already done, S5 `spawn` env already done, S6 bomb `take` already done, S8 DB param already done, S11 CORS already deferred

---

## 3. Threats (DoS-specific)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| D1 | Deep chain 5000 `isAncestor` | Attacker pushes 5000-deep chain, then `POST /refs/heads/main` with `hash` not ancestor → `isAncestor` BFS 5000× `execItehaas(['cat-file'])` each 30s timeout → 5000× spawn, FD, CPU | DoS, PG pool 10, 30s×5000 = 150k sec |
| D2 | `walk_log` unbounded | Repo 10k commits, `GET /log?max_count=200` but `walk_log` traverses all reachable before `truncate(200)` → `all_entries` 10k, each `flatten_tree` + `diff` → CPU/RAM | DoS |
| D3 | `search` full scan | `q= %` (3 chars? Actually min 2) `q=%` with `%` wildcard → `ILIKE %\%%` sequential scan on `repositories` 1M rows, `limit 50` but scan 1M | PG CPU |
| D4 | CI flood | `POST /ci/run` 100× fast → `runPipeline` spawns `docker` + `execItehaas` each, `queue` unbounded → disk, docker | Host DoS |
| D5 | `log` with `--all` + `--follow` path | `GET /history/*?ref=main` with `filePath` `a` that touches many commits → `walk_log` + `commit_touches_paths` per commit `flatten` 2× → 200 commits × flatten 2 = 400 tree reads | CPU |
| D6 | `POST /objects` 64M concurrent 10 → 640M disk, memory via `Buffer.concat` | Disk fill |  |

---

## 4. Affected Components

| File:line | Current | Risk |
|-----------|---------|------|
| `server/src/routes/repos.ts:558` `isAncestor` `MAX_STEPS 5000` | per call 5000, parallel | D1 |
| `vcs/src/revwalk.rs:152` `walk_log` `while queue` no max, `all_entries` sort, `truncate(max)` after walk | D2 | High |
| `server/src/routes/search.ts:7` `q` min 2, `limit 50`, no `statement_timeout` | D3 | High |
| `server/src/routes/ci.ts:289` `POST /ci/run` no rate-limit | D4 | High |
| `server/src/routes/repos.ts:872` `max_count` 200 but `isAncestor` + `log` each | D1/D2 |  |
| `server/src/routes/repos.ts:543` `Content-Length` 64M check | D6 | Already 64M but concurrent 10 → 640M |

---

## 5. Current Controls (what is already good)

- `S5` `vcsSemaphore(3)` limits concurrent `execItehaas` to 3, so `isAncestor` 5000 steps will be queued 3 at a time, not 5000 parallel
- `S6` `store.rs` `take(64M+1)` bomb guard, `tree` depth 100, entries 10000
- `S2` `rateLimit` for `login`/`register` 5/3 per min (but not for `search`/`ci`/`push`)
- `server/src/routes/repos.ts:543` `Content-Length` 64M + `Buffer` 64M + `verify` after write
- `server/src/routes/search.ts:11` `limit 1..50` `offset` clamped
- `server/src/routes/ci.ts:289` `workflow` size 64k? Not yet, but `collectArtifacts` limit 20 per dir + `size>10M` skip (S4)

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| `isAncestor` 5000 steps, no cache, no lower bound, no global timeout | SEC-014 | D1 |
| `walk_log` unbounded before truncate, no `max_commits`, no timeout | SEC-014 | D2 |
| `search` `q` up to 50? Actually `q` any len, `ILIKE %q%` no `statement_timeout`, `limit 50` but scan | SEC-014 | D3 |
| `CI` no rate-limit, no queue bound | SEC-014 | D4 |

---

## 7. Planned Remediation (S7 only, no S8+)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S7-01 | **Bound `isAncestor`** | `server/src/routes/repos.ts:558` `MAX_STEPS 5000` → `MAX_STEPS 2000` + early `if (visited.size > 2000) return false` + `visited` cache per `repoPath:ancestor:descendant` in-memory `Map` 60s + `execItehaas` already via `vcsSemaphore(3)` so parallel 3, add `timeout 8000` already but also `steps <2000` + `if steps>=2000 return 400 "history too deep"` | SEC-014 D1 | 5000-deep chain `POST /refs` →400 "too deep" not 5000 spawns |
| S7-02 | **Bound `walk_log`** | `vcs/src/revwalk.rs:152` `while queue` unbounded → `let maxCommits = opts.max_count.unwrap_or(200).min(200) + 100`? Actually walk should stop after `all_entries.len() >= max*2` or `visited.size > 10000` → `if visited.size>10000 { break }` + `if all_entries.len() > 10000 { break }` + `queue` max 10000 | SEC-014 D2 | `walk_log` 10k repo `GET /log?max_count=200` → visits ≤10000, truncated 200, not 10k |
| S7-03 | **Search limits + timeout** | `server/src/routes/search.ts:7` `if q.length<2` → `if q.length<2 || q.length>100` 400, `lim` default 20 not 20? Already 20 default but we will `Math.min(limit,20)` for search (currently 50) → `20` + `query` add `SET statement_timeout = 5000` via `query('SET statement_timeout = 5000')` before search, or `pool.query` with `timeout` | SEC-014 D3 | `GET /search?q=aaa...101 →400`, `q=%` still 20 results but `statement_timeout` 5s |
| S7-04 | **CI queue rate-limit** | `server/src/routes/ci.ts:289` `POST /ci/run` no limit → `checkRateLimit(req,'ci_run',5,60s)` + `if !allowed →429` + `maxConcurrent` via `vcsSemaphore` already? Actually CI `runPipeline` uses `setImmediate`, not semaphore, add `ciQueue` limit `if pending pipelines >20 →429` | SEC-014 D4 | 6th `POST /ci/run` in 1m →429 |
| S7-05 | **Global `max_count` clamp** | `server/src/routes/repos.ts:872` `maxCount = min(max(parseInt,200),200)` already 200, but add `if maxCount>200 →200` and `if maxCount<1 →1` (already) + `isAncestor` 2000 already | D1/D2 | `GET /log?max_count=1000 →200` |

**Explicitly NOT in S7:** FS symlink (S4), parser bomb (S6), CORS (S11), secrets (S9).

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `isAncestor deep` | `server/src/routes/s7-dos.test.ts` | mock `execItehaas` to return 5000 parents, `isAncestor` with `MAX_STEPS 2000` → 400 "too deep" |
| `walk_log bound` | `vcs/tests/s7_revwalk_test.rs` | create repo with 300 commits (via `cargo test` helper) → `walk_log` `max_count 200` visits ≤10000, truncated |
| `search limits` | `server/src/routes/s7-dos.test.ts` | `GET /search?q=aaa...101 →400`, `q=%` with limit 50 → capped 20, `statement_timeout` set |
| `CI flood` | same | 6 `POST /ci/run` in 1m →6th 429 |
| Existing | `cargo test --tests` 132 | Still pass after S7 |
| Manual | `curl` | `curl /log?max_count=1000` → 200 commits not 1000 |

Full suite after S7: `pnpm test` + `cargo test`.

---

## 9. Acceptance Criteria (S7)

- [ ] `isAncestor` `MAX_STEPS 2000` + `visited>2000` →400, cache, semaphore 3
- [ ] `walk_log` `visited>10000` or `all_entries>10000` → break, `max_count` 200
- [ ] `search` `q>100` →400, `limit` capped 20, `statement_timeout 5s`
- [ ] `CI` `POST /ci/run` 5/min →6th 429, queue >20 →429
- [ ] `GET /log?max_count=1000` →200
- [ ] `pnpm test` green + `cargo test` green
- [ ] `vulnerability-register.md` SEC-014 partially fixed (remaining search/CI done), `CYBERSECURITY_IMPLEMENTATION.md` S7 ✅, `PLAN.md` S7 ✅

---

## 10. Rollback Considerations

- `isAncestor` 2000 may break legitimate 3000-deep history (rare, but Vivobook 5000-deep is abnormal). Rollback to 5000 if legitimate 3000-deep repo has FF push rejected incorrectly. Increase to 3000.
- `walk_log` 10000 may truncate legitimate `log --all` with 15000 commits (large repo) — but `max_count=200` already truncates to 200, so walk 10000 not needed. Rollback to 20000 if repo 15000.
- `search` `q>100` may break long queries like code search `function foo bar baz` 120 chars — increase to 200 if legitimate.
- `CI` 5/min may break legitimate `push` burst 10 in 1m (e.g., monorepo) — increase to 10/min if needed.

---

## 11. Completion Verification (2026-09-02)

- `cargo test --tests` 132 green, `pnpm --filter server test` 72/72 (32+7+10+10+6+7) green, `pnpm build` ok
- `isAncestor` `MAX_STEPS 2000` + `visited>2000` →400, cache 60s, semaphore 3 via `vcsSemaphore`, `walk_log` `visited>10000` + `all_entries>10000` → break, `search` `q>100` →400, `limit` 50→20, `offset>10000` →400, `statement_timeout 5000`, `CI` 5/min →6th 429, queue 20 →429
- `server/src/routes/s7-dos.test.ts` 7 tests green
- No FS/CORS edits — S7 scope respected

---

## 11. Next Phase

**S8 — Database / SQL Security** — after S7 STOP. Do not touch `pg` param in S7 (already).

**STOP per §8 — S7 Complete. Awaiting S8 approval.**
