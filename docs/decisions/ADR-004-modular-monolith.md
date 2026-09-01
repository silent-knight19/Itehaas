# ADR-004: Why Modular Monolith Initially

Date: 2026-09-01
Status: Accepted

## Context

Single Vivobook, <10 users, no need for distributed infra.

## Decision

Monorepo with workspace members (vcs, server, web), single docker-compose, CLI boundary Node↔Rust. Split services only after measured bottleneck.

## Consequences

Simple deploy, debuggable (`spawn` + stderr), low overhead. Upgrade path to `itehaasd` daemon if spawn cost measured.

## Alternatives

Microservices/K8s/Kafka/service mesh — rejected as overkill for Phase 1.
