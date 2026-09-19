# Frozen shared contracts

Captain-owned. TypeScript consumers import @orchestra/contracts. Authoring source is src/models.ts and src/messages.ts; generated/schemas.json is the Python draft-07 schema registry. src/otc.ts authors the packet encoder; generated codebook/goldens are shared by renderer and decoder.

Run bun run contracts:generate only for an agreed change, followed by fixtures:generate where required. Gates check deterministic output and goldens. Never hand-edit generated files, duplicate wire schemas in a consumer, or use generation to hide a failing expectation.

Semantics and versioning: .devcontext/schema/{protocol,playback,otc}.md. The schemas enforce structure; the backend must enforce auth, unique membership/references, run/revision identity and effective-time consistency.
