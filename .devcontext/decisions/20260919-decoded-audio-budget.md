# Shared 512 MiB prepared-audio budget

Date / author / team: 2026-09-19 / integration captain.
Status: accepted, requested by the user during local integration.
Affected teams: sync/control, audio/client, admin/console, shared contracts.

## Context

The user's 405.5 MiB prepared show cannot be saved because three independent implementations cap decoded buffers at 64 MiB. Increasing only one leaves either saving or participant preloading broken.

## Decision

Export one 512 MiB decoded-audio budget from the contracts package. The editor displays/checks it, backend validation uses it, and participant DecodedBudget defaults to it. Retain actual decoded-buffer accounting and explicit smaller budgets for tests/callers. Protocol v1 and generated schemas remain unchanged.

## Consequences

The requested show fits, while an upper bound remains. This permits more memory use per phone; temporary decode buffers, encoded files and browser overhead are additional. It does not establish that every phone can load a 512 MiB show. Short mono stems remain the preferred physical-demo preparation. Tests cover the observed show size and the new boundary, followed by live save/load verification.
