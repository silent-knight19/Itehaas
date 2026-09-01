# ADR-001: Why Rust for VCS

Date: 2026-09-01
Status: Accepted

## Context

Need systems control, filesystem/binary correctness, determinism, learning value.

## Decision

Rust with Tokio (later), Serde for non-canonical metadata only, sha2/flate2/clap.

## Consequences

Performance, safety, explicit error handling. Build toolchain required (rustup).

## Alternatives

Go (hides ownership), Node (unsuited for FS/binary), C (unsafe).
