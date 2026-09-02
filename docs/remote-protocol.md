# Itehaas Remote Protocol — HTTP Own Protocol v1 (Phase 12)

> Source of truth for distributed sync. `clone` already ships; `fetch`/`push`/`pull` extend it. Not Git wire; own JSON + raw zlib objects. Git interop deferred to 12.9.

## 1. Goals & Non-Goals

* **Goals (Phase 12):** Correct incremental sync over `http(s)`, single-flight auth via `ITEHAAS_TOKEN`, incremental object transfer (only missing), atomic ref update with fast-forward safety, streaming without loading packs fully in memory, private-repo 404-mask.
* **Non-Goals:** SSH transport, Git pack negotiation `have/want/ACK`, delta/thin packs (Phase 12.5), SHA-1 interop (12.8), `git` CLI wire compatibility.

## 2. URL Shape & SSRF Guard

* Strict whitelist `validate_http_base` `vcs/src/remote/http.rs:54`: must be `http(s)://host/api/repos/<owner>/<repo>` where owner/repo `^[a-zA-Z0-9._-]{1,100}$` (`..`/`.`/`//` rejected), contains `/api/repos/`, max 100, no `\0`/` `, no `?query` allowed at base. Redacted logs via `redact_url` (strip `?`).
* Server validates via `repoPathFor(owner,repo)` `server/src/lib/vcs.ts:17` `startsWith(root+sep)` + `\0` guard + `HASH_REGEX`.

## 3. Refs Discovery (Advertisement)

* **Request:** `GET {base}/refs` — no body, `Authorization: Bearer <token>` + `Cookie: itehaas_session=<token>` (either), `token_from_env()` reads `ITEHAAS_TOKEN` then `ITEHAAS_SESSION` `http.rs:39`.
* **Auth & ACL:** Server `GET /api/repos/:owner/:repo/refs` `repos.ts:317` checks `canRead(repoId, userId, visibility)`; private → `404` not `403` (enumeration defense). Works for `fetch` (read) and `push` pre-flight.
* **Response:** `200 { refs:[{name:"refs/heads/main",hash:"64hex"},…], head:"refs/heads/main" | "64hex", hasher:"sha256" }` sorted `name`. `name` must start `refs/heads/` + branch `is_valid_branch_name`; `hash` 64 hex. Missing `refs` → `[]` (empty repo). `head` defaults `refs/heads/main`.
* **Failures:** `401/403` → hint `set ITEHAAS_TOKEN`, `404` → not found, `500` → stderr.

## 4. Object Transfer (Content-Addressed)

* **Object store invariant:** `ObjectID = H(header"\0"body)` uncompressed, `Stored = zlib(header"\0"body)` `object/store.rs:30`, fanout `2/62`, `64MiB` limit.
* **Download (clone/fetch):** `GET {base}/objects/{64hex}` → `200 application/octet-stream` raw zlib bytes, headers `Content-Length` (≤64M → `413` else), `Cache-Control: public max-age=31536000 immutable`, `X-Content-Type-Options: nosniff`, `X-Object-Hash`. Stream `8k` chunks `total≤64M` `http.rs:268`, atomic `NamedTempFile::new_in(dir)→persist`, immediate `store::read_object` verification (header, len, re-hash) `http.rs:295`.
* **Visited dedup:** `HashSet<hex>` `MAX_OBJECTS 100k`, `MAX_DEPTH 2048` `http.rs:14` guards BFS. `download_recursive_http` parses Commit→tree+parents, Tree→entries (`040000` subtree recurse else blob fetch), Blob leaf, Tag→object. Shared `visited` across heads.
* **Incremental fetch optimization:** Client `fetch_http` does `GET /refs`, then for each remote head not equal local `refs/remotes/origin/*` and not already local via `object_path.exists()` check, calls `download_recursive_http`. Only missing reachable DAG is fetched. No server `have` filtering yet (future `POST /refs/negotiate`).

## 5. Upload (Push)

* **Auth:** Server `POST /objects/:hash` and `POST /refs/...` require `canWrite(repoId, userId)` (`403` if read-only). Token same as above, checked via `getSessionUser` → `requireAuth` + `canRead/canWrite` `middleware/auth.ts:15`. Private repo mask preserved.
* **Object upload (Phase 12.3):**
  * Request: `POST {base}/objects/{hash}` `Content-Type: application/octet-stream` body = raw zlib bytes (`64M` cap, `413` if larger). Alt batch: `POST {base}/objects` `Content-Type: application/octet-stream` with `ITEHAAS PACK`-like framing is deferred; initial uses per-object POST for simplicity and to reuse `GET` verification path.
  * Server: validate `HASH_REGEX`, `repoPathFor` traversal, `Content-Length` ≤64M, stream to temp (`NamedTempFile`), `persist` atomically, `store::verify_object` (decompress → header `\0` → len → re-hash). If `dest exists` → `200 {ok, dedup:true}` else `201 {ok, hash}`. On `hash mismatch / CorruptObject` → `400`.
  * Client: `collect_reachable_objects` `remote.rs:19` BFS from local head(s) not ancestors of remote head, `transfer_objects_http` iterates, skips if `remote` already has (optimistic, but server dedup covers), POSTs each with `ureq` streaming (no full pack buffer).
  * Concurrency: client POSTs sequentially (bounded concurrency 4 later). Server writes are atomic rename, no lock needed for object store (content-addressed).
* **Ref update (atomic CAS):**
  * Request: `POST {base}/refs/heads/{branch}` (or `PATCH`) body `{ hash:"64hex", force: bool }` `Content-Type: application/json`.
  * Server: `zod` validate `branch` `^[a-zA-Z0-9._/-]{1,100}$` + `validate_branch_name` + hash, load current ref `read_ref(refs/heads/branch)`. Fast-forward check: if `force==false` and `current.is_some()` then `is_ancestor(repo, current, new)` via `merge::is_ancestor` (`execItehaas` or lib call). If `!is_ancestor` and `current != new` → `409 {error:"non-fast-forward"}`. If `force==true` skip check.
  * Then `write_ref_with_log(repo, refs/heads/branch, new, "push: ...")` atomically, also update `HEAD` log via `reflog::append_reflog` (branch + `HEAD` if symbolic). Return `200 {ok, branch, hash, previous}`. Race: read current + `write_ref` without lock → window for concurrent push. Fix via `fs` lock file `.itehaas/refs/heads/branch.lock` (`flock` or `open(O_CREAT|O_EXCL)`) held during check+write. If lock held → `423 Locked` / retry.
  * Client: after successful ref update, `write_ref(refs/remotes/origin/branch, hash)` + local `refs/heads/branch` unchanged (push doesn't move local).

## 6. Fetch (Incremental) Detailed Flow

```
client GET /refs  (auth) → {refs, head, hasher}
  compare hasher vs local hasher → bail if mismatch (HashAlgoMismatch)
  for each (name, hash) in remote.refs:
     local_remote = read_ref(refs/remotes/origin/branch)
     if local_remote == hash → skip (already)
     else download_recursive_http(base, repo, hash, visited)
          // visited dedup + object_path.exists() check avoids re-fetch
          // fetch_object_http for each missing
     write_ref(refs/remotes/origin/branch, hash)
     log reflog remote-tracking
  // HEAD unchanged, working tree unchanged
```

* **Missing objects:** only those not present locally are fetched; if server has 100k objects and client has 99k, only 1k transferred (measured via `visited.len()`).
* **Failure handling:** if `fetch_object_http` 404 → remote has missing object (corrupt remote) → abort `rm -rf` cleanup for clone, else fetch aborts and user can retry. Partial `refs/remotes` not updated on failure (all-or-nothing per ref: update only after successful DAG).

## 7. Push Flow

```
client GET /refs → remote_refs
  resolve local branch hash (HEAD or --branch)
  remote_hash = remote_refs[refs/heads/branch]
  if remote_hash == local_hash → "Already up to date"
  if --force==false && !is_ancestor(remote_hash, local_hash) → bail non-fast-forward
  missing = collect_reachable(local_hash) - ancestors_of(remote_hash)  // via BFS visited
  for h in missing (sorted):
     if !object_path_exists_local? (always true) POST /objects/{h} body=zlibBytes
  POST /refs/heads/branch {hash: local_hash, force}
  on 200: write remote ref local copy
```

* **Incremental:** only commits not ancestor of remote are sent. If remote empty → send full reachable.
* **Atomic-ish:** objects uploaded before ref update; if client crashes after objects but before ref update, objects are reachable via `fsck` unreachable (GC will keep until ref updated or prune after). Ref update is atomic via lock.

## 8. Pull = Fetch + Merge

* `pull_http` = `fetch_http` then `merge` (`vcs/src/merge.rs`) using `fetch` result remote hash vs current head. Reuses `merge::merge` 3-way / FF. No rebase path yet (Phase 13).

## 9. Pack & Streaming (Deferred Incremental)

* Current `pack.rs:1` `ITEHAAS PACK v1` (`header + u32 count + hex+len+zlib per object`, no delta, 201% size). For HTTP push, per-object POST avoids packing; for large pushes (>100 objects) future `POST /pack` with `ITEHAAS PACK v1` streaming (`Content-Length` or chunked) will be added, with `pack::verify_pack` on server side streaming (`ZlibDecoder` per entry, no full buffer >64M+pack metadata). This removes `MAX_OUTPUT 1MiB cap` `server/src/lib/vcs.ts:33` for pack route (stream).
* Negotiation `want/have/ACK` deferred; current client-side dedup is sufficient for <10k objects. Future: `POST /refs/negotiate` `{ wants:[hash], haves:[hash] }` → server returns `missing:[hash]` using `collect_reachable_objects` difference, to reduce upload for deep histories.

## 10. Authentication & Security

* `Authorization: Bearer <uuid>` (`ITEHAAS_TOKEN`) + `Cookie: itehaas_session` `middleware/auth.ts:13` `validateSessionId` UUID regex, `expires_at>now()`, `JOIN sessions`. Private repo `404` mask everywhere.
* `validate_http_base` `http.rs:54` + `repoPathFor` `vcs.ts:17` + `object_path` `startsWith(root+sep)` + `HASH_REGEX` + `\0` guard + `Content-Length` 64M + `MAX_OBJECTS`/`MAX_DEPTH` + `ureq` TLS verified + `redact_url` never log token + atomic tempfile→persist + re-hash verify after download + `flock` for ref update.

## 11. Hash & Verification

* One repo = one `hasher` `config::read_hasher` (`sha256` default, `sha1` stub in 12.8). All store paths `2/62` for sha256; mismatch → `HashAlgoMismatch`. Server rejects `hasher` mismatch on clone/fetch/push (client aborts). Pack and object verification always via `store::read_object`.

## 12. Failure Handling

* Clone: on any error after `init` → `remove_dir_all(dest)` (`main.rs:1522`).
* Fetch/Push: per-ref transaction: `refs/remotes` or `refs/heads` only updated after DAG success. On `409` non-ff → user must `--force` or `fetch+merge`. On `423` lock → retry 3x with backoff.
* GC: `gc --prune` respects unreachable after failed push objects (no ref) → may prune them; acceptable as they were never advertised. `fsck` detects `missing_refs`.

## 13. Future (12.5+)

* `POST /pack` streaming, delta xdelta, thin-pack, `pack index`.
* SHA-1 repo mode (`HashAlgo::Sha1` 20B, `hex_len 40`, `object_path` `2/38`).
* Git interop test suite `vcs/tests/interop_tests.rs` using `git` as oracle (Phase 12.9).

---
*Implementation order: 12.1 doc → 12.2 fetch_http (client+reuse) → 12.3 push server+client → 12.4 pull → 12.5 pack streaming.*
