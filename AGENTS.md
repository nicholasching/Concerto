# Project instructions

Before working here, read `rules.md`, `masterplan.md`, and `.devcontext/README.md`, then your assigned stage brief and relevant decisions.

- Follow the four-team branch/file ownership and independent verification requirements in those documents.
- Document assumptions, decisions, experiments, failures, checks, and handoffs continuously under `.devcontext/`.
- Keep `beatsync-source/` unchanged as reference code. Extract required implementation into the main application folders/shared packages with provenance and MIT attribution; never depend on the reference tree at runtime.
- This repository has a verified `foundation-v1` scaffold. Read the master plan's team handoff and your stage brief: contracts, fixtures, shells and gates exist; concert features remain team work. Do not rebuild the foundation or treat passing scaffold tests as feature completion.
- Run your focused gate from the repository root. Extend it with meaningful tests for your implementation and record physical checks separately. The captain owns root scripts/config, lockfiles, CI, shared contracts/testkit, and generated fixtures.
- Preserve existing user changes. Resolve shared contract changes with their owner before editing consumers.
