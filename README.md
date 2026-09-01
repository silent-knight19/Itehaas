# Itehaas

Git-inspired distributed version-control system + GitHub-like platform, self-hosted on a single laptop.

See `PLAN.md` for roadmap, `docs/object-model.md` for object spec, `docs/storage.md` for storage.

## Quick start (Phase 1)

```bash
cargo build -p itehaas
./target/debug/itehaas init /tmp/r1
echo -n hello | ./target/debug/itehaas hash-object -w --stdin
./target/debug/itehaas cat-file -p <hash>
./target/debug/itehaas verify <hash>
cargo test -p itehaas
```
