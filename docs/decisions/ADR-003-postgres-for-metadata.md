# ADR-003: Why PostgreSQL for Metadata

Date: 2026-09-01
Status: Accepted

## Context

Platform needs ACID, concurrent pushes, permissions, issues/PRs.

## Decision

PostgreSQL 16 for metadata (users, repos, members, issues, PRs, comments, stars, notifications, webhooks). No file content stored. Conservative defaults; tuning only after benchmarks on Vivobook.

## Alternatives

SQLite (insufficient concurrency), MySQL (less DDL), DB for objects (rejected per ADR-002).
