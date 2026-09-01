# Itehaas — Object Model Specification

> **Source of truth.** Rust implementation follows this document byte-exactly. If code and spec diverge, fix the code.

## 1. Central Invariant

```
Object ID     = H(canonical_header || 0x00 || canonical_body)
Stored bytes  = zlib(canonical_header || 0x00 || canonical_body)
```

- `H` is the repository's hash algorithm (Phase 1: `SHA-256`). Hashing always operates on the **uncompressed** canonical representation, never on compressed bytes.
- `canonical_header = "<type> <body_len>"` where `<type> ∈ {blob,tree,commit,tag}`, `<body_len>` is decimal ASCII length of `canonical_body`.
- `\0` is a single `0x00` byte.

Verification on read: decompress → split at first `\0` → parse header → check `body.len() == len` → check `type` matches expected → recompute `H(header+\0+body)` → compare to requested hash.

## 2. Hash Algorithm Invariant

- One repository uses **exactly one** hash algorithm. Recorded once at `init` in `.itehaas/config` as `[core] hasher = sha256`.
- All objects in that repository use that algorithm. No mixed-algorithm objects.
- On read/write, the store validates: `hash.len() == hasher.hash_len()`. Mismatch → `Error::HashAlgoMismatch`.
- Changing algorithm requires a new repository (or a future explicit migration tool). Future `SHA-1`/`BLAKE3`/`Git-compat` will be implemented behind the same `Hasher` trait without rewriting the store.
- Phase 1 implements **SHA-256 only**. `HashAlgo::Sha1`/`Blake3` exist as enum variants but return `Error::UnsupportedAlgo` if selected.

Object ID is hex-encoded (`hex::encode(raw_bytes)`), lowercase, `64` chars for SHA-256 (`32` raw bytes). Regex for validation: `^[0-9a-f]{64}$` (for SHA-256).

## 3. Object Types

### 3.1 Blob

Stores raw file contents.

```
body = raw file bytes (no transformation, no newline fixup)
type = "blob"
```

Empty file: `body = ""`, header `"blob 0"`, so `hash_input = "blob 0\0"`, `ObjectID = SHA256("blob 0\0") = 473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813` (note `e3b0...` is `SHA256("")`, not the blob hash).

### 3.2 Tree

Represents directory structure. Git-inspired deterministic encoding, **not** Git-compatible until tested against `git mktree` vectors.

```
type = "tree"
body = concat(entries sorted by name, bytewise ascending)
entry = "<mode_ascii> <name_utf8> \0 <hash_raw_bytes>"
```

- `mode_ascii`: octal without leading zeros. Allowed: `"100644"` (regular file), `"100755"` (executable), `"40000"` (subdirectory). More modes deferred.
- `name_utf8`: UTF-8, non-empty, must not contain `"/"` or `"\0"`. No leading/trailing spaces special handling — bytes are literal.
- `hash_raw_bytes`: raw `H` output (32B for SHA-256), not hex. Size determined by repo's algorithm.
- Sorting: bytewise (`u8`) lexicographic on `name`. Duplicates forbidden (→ `InvalidObject`).
- Header: `"tree <body_len>"`.

Example (two entries):
```
body = "100644 hello.txt\0" + <32B hash> + "40000 src\0" + <32B hash>
```

### 3.3 Commit

```
type = "commit"
body =
  "tree <tree_hash_hex>\n"
  ("parent <hash_hex>\n")*          // 0 for root, 1 normal, N for merge; order preserved as given
  "author <name> <email> <timestamp> <tz>\n"
  "committer <name> <email> <timestamp> <tz>\n"
  "\n"
  "<message>"
```

- `name`/`email`: UTF-8, must not contain `<`, `>`, or `\n`. Email expected as free-form but no `\n`.
- `timestamp`: `i64` seconds since UNIX epoch, decimal ASCII.
- `tz`: timezone offset `±HHMM` (e.g., `+0000`, `+0530`, `-0800`). Must match `^[+-][0-9]{4}$` and `HH<24`, `MM<60`.
- Field order is canonical and enforced on parse; out-of-order → `InvalidObject`.
- Message: UTF-8, may contain newlines, may be empty. No extra trailing newline added by serializer if message empty.
- Header: `"commit <body_len>"`.

### 3.4 Tag (Annotated Tag)

```
type = "tag"
body =
  "object <target_hash_hex>\n"
  "type <target_type>\n"          // "blob" | "tree" | "commit" | "tag"
  "tag <name>\n"
  "tagger <name> <email> <timestamp> <tz>\n"
  "\n"
  "<message>"
```

Same `Signature` rules as commit. Stored but not exercised in Phase 1 vertical slice.

## 4. Determinism Rules

- Trees: entries sorted, no duplicates.
- Commits/Tags: field order fixed, LF (`\n`) only, no CRLF, no trailing whitespace beyond spec.
- All hashes hex-encoded lowercase when appearing in text bodies (tree not included — raw there).
- UTF-8 everywhere unless raw bytes (blob content = raw, tree hash raw).
- Size limit Phase 1: reject objects > 64 MiB (`ObjectTooLarge`).

## 5. Serialization / Parsing

- Serialization produces canonical bytes per above.
- Parsing is strict: rejects truncated, out-of-order, duplicate, invalid UTF-8 where required, wrong hash hex length, bad mode, bad tz.
- Implementation: `Object::canonical_body() -> Vec<u8>`, `Object::object_type() -> &str`, `Object::parse(type, body) -> Object`.

## 6. Future Extensions

- `SHA-1` (20B) / `BLAKE3` (32B) behind `Hasher` trait, fanout path width stays `2` hex chars.
- Git compatibility: requires adapting tree raw length (20 vs 32) and testing interop; not claimed until then.
- Extended modes (`120000` symlink), `GPG` signatures — deferred.
