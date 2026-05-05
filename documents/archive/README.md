# Archived Documentation

> ⚠️ **DO NOT USE FOR REGENERATION.**
>
> The files in this folder are historical specifications, proposals,
> and superseded versions. They are kept only as a record of how the
> system evolved.
>
> The current, code-grounded specification lives in `documents/`
> (one level up). Start with `documents/README.md`.

## Why these were archived

A documentation audit (see issue: "docs: comprehensive review of feature
documentation as a regeneration specification") found that the previous
feature docs:

- Mixed proposals with implemented behaviour, with no status markers.
- Documented commands and intents that no longer exist on the active
  code path (e.g. `EXECUTE_COMMAND`, `communication.chat.send`).
- Split a single contract across multiple files (the session check-in
  RFC was spread across `feature_session_claim.md`,
  `rc-response-to-session-checkin.md`, and `response_session_checkin.md`).
- Omitted the `window.electronAPI` contextBridge surface entirely —
  the renderer could not be regenerated from docs alone.
- Underspecified the `ExtensionAPI`, the `$var()` resolution syntax,
  the `RaceContext` struct, the `PublisherEvent` envelope, and the
  WebSocket overlay protocol.

The replacement docs in `documents/` are written against the live code
in `src/`, with file/line references where useful. They prefer
correctness over comprehensiveness, and explicitly omit dead code paths.

## What was archived

| File | Reason |
|---|---|
| `overview.md` | Rewritten — new version describes startup sequence and orchestrator. |
| `feature_extension_system.md` | Rewritten — new version specifies `ExtensionAPI`, IPC protocol, two-tier registry. |
| `feature_director_loop.md` | Superseded by v2; v2 superseded by `architecture-orchestrator.md` + `feature_session_claim.md`. |
| `feature_director_loop_v2.md` | Proposal-era doc; replaced by `architecture-orchestrator.md`. |
| `feature_session_claim.md` | Consolidated with the two RC response files into a single new doc. |
| `rc-response-to-session-checkin.md` | Merged into `feature_session_claim.md`. |
| `response_session_checkin.md` | Merged into `feature_session_claim.md`. |
| `feature_sequence_executor.md` | Rewritten — new version specifies built-in intents and dispatch. |
| `feature_sequence_executor_ux.md` | Mostly UX-mockup; relevant parts folded into `feature_sequence_scheduler.md`. |
| `feature_iracing_extension.md` | Rewritten — new version covers FFI, intents, events, internal directives. |
| `feature_iracing_publisher.md` | Rewritten — new version specifies the wire schema and detector inventory. |
| `feature_obs_integration.md` | Rewritten — new version maps service ↔ extension boundary. |
| `feature_overlay_system.md` | Rewritten — new version specifies the WebSocket protocol and port config. |
| `feature_talk_to_drivers.md` | Rewritten — new version specifies the TTS API contract and FFmpeg packaging. |
| `feature_stream_chat.md` | Rewritten — new version uses the actual intent names. |
| `feature_entra_id_login.md` | Rewritten — new version reflects `safeStorage` cache. |
| `feature_merged_header.md` | Folded into `architecture-orchestrator.md` (renderer section). |
| `design_sequence_ux_enhancements.md` | Proposal-era; not a regeneration spec. |
| `issues_publisher_redesign.md` | Closed-issue retrospective. |
| `rc-response-to-director-proposal.md` | RC team correspondence; not a spec. |
