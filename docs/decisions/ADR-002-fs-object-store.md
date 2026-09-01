# ADR-002: Why Filesystem Object Store (not DB)

Date: 2026-09-01
Status: Accepted

## Context

Need content-addressable, hash-derived identity, single-machine simplicity.

## Decision

`.itehaas/objects/ab/cdef...` with zlib(header+\0+body), fanout, atomic writes. One repo one hash algo (SHA-256 default, trait for future).

## Consequences

Simple, inspectable, Git-inspired. Packfiles/delta deferred to Phase 10. Deduplication free.

## Alternatives

Postgres for objects (breaks CAS separation, bloat), MinIO (added infra).
