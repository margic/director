# Director Documentation

This folder is the **canonical regeneration specification** for the
Director codebase. A developer or AI agent reading only these documents
should be able to reproduce the application to a production-quality
standard.

The documents are written **against the live code in `src/`**. Where a
section describes future or proposed behaviour, it is explicitly marked
`STATUS: PROPOSED`. Everything else is `STATUS: IMPLEMENTED` and reflects
what is on the active code path today.

If a document and the code disagree, the code wins — open a PR to fix
the document.

## Reading order

For someone new to the project, read in this order:

1. **`overview.md`** — what Director is, the two-tier product model
   (open-source core ↔ premium cloud intelligence), the Director Loop
   vs. Control Deck distinction, and the startup sequence.
2. **`architecture-orchestrator.md`** — the main-process composition:
   `DirectorOrchestrator`, `SessionManager`, `CloudPoller`,
   `SequenceScheduler`, and how they wire together.
3. **`api-contextbridge.md`** — the `window.electronAPI` surface
   exposed to the renderer. **Required** for renderer regeneration.
4. **`data-models.md`** — canonical type definitions for `RaceContext`,
   `PortableSequence`, `ExecutionResult`, `PublisherEvent`,
   `DirectorCapabilities`, and the session check-in messages.
5. **`feature_extension_system.md`** — how extensions are scanned,
   loaded into a utility process, exposed via `ExtensionAPI`, and
   mediated by the IntentRegistry / CapabilityCatalog two-tier
   registry.
6. **`feature_sequence_executor.md`** + **`feature_sequence_scheduler.md`**
   — execution model.
7. **`feature_session_claim.md`** — the five-phase session check-in
   lifecycle and the cloud contract.

Then per-extension and per-integration specs:

- `feature_iracing_extension.md`
- `feature_iracing_publisher.md`
- `feature_obs_integration.md`
- `feature_overlay_system.md`
- `feature_talk_to_drivers.md` (Discord + TTS)
- `feature_stream_chat.md` (YouTube)
- `feature_entra_id_login.md`

Cross-cutting:

- `security_design.md` — secret storage, IPC isolation.
- `race_control_description.md` — the cloud API surface as it relates
  to Director.
- `example_data.md` — realistic sample payloads (used by tests).

The `brand/` and `observability/` subfolders contain non-engineering
material (brand guidelines, Application Insights setup) and are
referenced by code only indirectly.

## Conventions used in these documents

- **File:line refs** — `src/main/foo.ts:42` points at the canonical
  implementation. These are the source of truth.
- **Code blocks** — TypeScript snippets are excerpts of the real
  interfaces; they are kept in sync with `src/` types.
- **State machines** — drawn as ASCII transition tables; the enum
  values match the literals in code.
- **Endpoints** — fully qualified relative to `apiConfig.baseUrl`
  (default `https://simracecenter.com`); see
  `src/main/auth-config.ts` for the full table.

## Out-of-scope topics

The following are intentionally **not** documented here because they
would not help a regenerating agent:

- The historical evolution of the Director Loop (see `archive/`).
- Closed-issue retrospectives.
- UX mockups that were never implemented.
- Vendor-specific build tooling beyond what `package.json` declares.
