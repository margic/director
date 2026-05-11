# Ubiquitous Language — Project Glossary

> **Status:** Canonical source of truth for terminology across `margic/racecontrol` and `margic/director`.
> **Audience:** Engineers, AI prompt authors, doc writers, and reviewers.
> **Rule:** When a term in this glossary applies, use the canonical name *exactly* — in code, types, API fields, prompts, comments, docs, and PR descriptions. Do not introduce synonyms.

## Why this exists

The Sim RaceCenter domain reuses everyday racing words ("driver", "scene", "director", "context") for several distinct technical concepts. The ambiguity has caused real defects (e.g. [#315](https://github.com/margic/racecontrol/issues/315) — `targetDriver` template variable named after a person but actually holding a car-number string; historically also confused with an iRacing car-index integer) and degrades the quality of AI-generated sequences because the model has to *guess* which sense is meant in any given prompt sentence.

This glossary fixes the vocabulary so that:

1. Every concept has exactly one canonical name.
2. Every type name, API field, prompt phrase, and document phrase reuses that canonical name.
3. Deprecated aliases are listed explicitly so reviewers can flag them.

The companion document [`features/ubiquitous-language-plan.md`](features/ubiquitous-language-plan.md) tracks the rollout (issues, PRs, migration status per surface).

## How to read each entry

Each term is presented as:

| Field | Meaning |
|---|---|
| **Canonical** | The single approved name. Use this verbatim. |
| **Definition** | Short, behavioural definition. |
| **Type / shape** | The runtime representation (string, integer, object, etc.). |
| **Where it lives** | TypeScript types, Cosmos containers, OpenAPI fields, prompts. |
| **Deprecated aliases** | Names that **must not** be reintroduced. Flag in review. |
| **Status** | `done` / `in-progress` / `planned` (mirrors the rollout plan). |

---

## 1. People, cars, and entries (the "driver" cluster)

The word **driver** in everyday racing means a human being. In this system it has been used to mean *at least six* different things. The canonical vocabulary separates **people**, **session registrations**, **on-track cars**, and **identifier values**.

### 1.1 `RacerProfile` (a person / racer)

| | |
|---|---|
| **Canonical** | `RacerProfile` (TypeScript type) — refer to it as a *person* in prose |
| **Definition** | A human being who has (or could have) a profile in SimRaceCenter. Independent of any specific race session. |
| **Type / shape** | Cosmos document in `userProfiles` (authenticated users) or `drivers` (driver roster, historically named) container. |
| **Where it lives** | `userProfiles`, `drivers` Cosmos containers; `Driver` TypeScript type today. |
| **Deprecated aliases** | "driver" (in prose, when it means the racer rather than the entry); "user" (when it specifically means a racer rather than any authenticated user). |
| **Status** | `planned` — rename `Driver` type → `RacerProfile`; keep the `drivers` container name (data migration not required). |

> **Why the distinction matters:** A Person can exist with no active session. A SessionEntry exists only inside a RaceSession.

### 1.2 `SessionEntry`

| | |
|---|---|
| **Canonical** | `SessionEntry` |
| **Definition** | The registration of one car + driver pairing in a specific `RaceSession`. Carries the car number, the OBS onboard scene (if any), and a reference back to a `Person`. |
| **Type / shape** | TypeScript `interface SessionEntry { ... }`. Currently named `RaceSessionDriver` in `api/src/types/race-session.ts`. |
| **Where it lives** | `RaceSession.entries[]` (currently `RaceSession.drivers[]`). |
| **Deprecated aliases** | `SessionDriver`, `RaceSessionDriver`, `sessionConfig.drivers[]`. |
| **Status** | `planned` — see issue **UL-2** in the plan. |

### 1.3 `FocusEntry` (a.k.a. **focus driver**)

| | |
|---|---|
| **Canonical** | `FocusEntry` (type) / **focus driver** (prose, prompts) |
| **Definition** | A `SessionEntry` for which the broadcast has a dedicated OBS onboard scene. These are the cars the broadcast *follows*. There are typically 1–4 in a session. |
| **Type / shape** | A `SessionEntry` whose `obsSceneName` is set. Not a separate document. |
| **Where it lives** | Detected at runtime from `SessionEntry.obsSceneName != null`. |
| **Deprecated aliases** | "our drivers", "SimRaceCenter driver", "team driver", "A-list", "team car", "primary driver". **All of these must be replaced** by `focus driver` in prompts and `FocusEntry` in code. |
| **Status** | `planned` — prompt-prose change tracked alongside [#316](https://github.com/margic/racecontrol/issues/316). |

### 1.4 `FieldEntry` (a.k.a. **field car**)

| | |
|---|---|
| **Canonical** | `FieldEntry` (type) / **field car** (prose, prompts) |
| **Definition** | Any car on track that is **not** a `FocusEntry`. Has no dedicated OBS onboard scene. The broadcast can show it only via the RaceDirector camera feed (`broadcast.showLiveCam`) or via overlays. |
| **Type / shape** | Logical category — a leaderboard entry whose `carNumber` does not match any `FocusEntry.carNumber`. |
| **Where it lives** | Derived at executor time from `raceContext.drivers[]` minus `FocusEntry` car numbers. |
| **Deprecated aliases** | "field driver", "non-team car", "non-focus driver", "background car". |
| **Status** | `planned`. |

### 1.5 `carNumber`

| | |
|---|---|
| **Canonical** | `carNumber` |
| **Definition** | The display number painted on a car. Treated as a **string** because iRacing allows leading zeros, letters, and multi-character numbers (e.g. `"08"`, `"#7A"`). |
| **Type / shape** | `string`. |
| **Where it lives** | `raceContext.drivers[].carNumber`, `SessionEntry.carNumber`, sequence step payloads. |
| **Deprecated aliases** | `driverNumber`, `carNum`, bare "driver" when the value is in fact a car number string. **Never store a car number in a variable called `driver`, `targetDriver`, or `secondDriver`.** |
| **Status** | `in-progress` — value already standardised; variable-name renames pending (see UL-3). |

### 1.6 `carIndex`

| | |
|---|---|
| **Canonical** | `carIndex` |
| **Definition** | The integer index iRacing assigns to each car in the session (zero-based, dense). Useful only when calling iRacing-specific APIs that take indices (e.g. `irsdk` camera switching). |
| **Type / shape** | `integer`. |
| **Where it lives** | iRacing telemetry plumbing inside the Director app. Should not appear in cloud APIs or prompts. |
| **Deprecated aliases** | "car id" (ambiguous with `carNumber`), "driver index", bare "driver" when an integer is passed. |
| **Status** | `done` (already separated, but must remain explicitly distinct from `carNumber` — see [#315](https://github.com/margic/racecontrol/issues/315)). |

### 1.7 `driverName`

| | |
|---|---|
| **Canonical** | `driverName` |
| **Definition** | The human-readable name of the person driving a car (e.g. `"Paul Crofts"`). Used in TTS, chat output, and overlays. |
| **Type / shape** | `string`. For field cars without a known name, use the placeholder `"Car {carNumber}"`. |
| **Where it lives** | `raceContext.drivers[].driverName`, sequence step `payload.text` after variable resolution. |
| **Deprecated aliases** | "racer name", "operator name", "user name" (when referring to the racer). |
| **Status** | `done`. |

---

## 2. Sequences

The system distinguishes three lifecycle stages of a "sequence" — they are **not** interchangeable.

### 2.1 `BroadcastSequence`

| | |
|---|---|
| **Canonical** | `BroadcastSequence` |
| **Definition** | A fully resolved, ready-to-execute sequence on the wire. All variables are filled. The Director app executes the `steps[]` in order. |
| **Type / shape** | `interface BroadcastSequence { id, name, version, category, priority, steps[], metadata, ... }`. Currently named `PortableSequence` in `api/src/types/director.ts`. |
| **Where it lives** | Response body of `POST /api/director/v1/sessions/{id}/sequences/next`; `sessionSequences` Cosmos container (new) or legacy `portableSequences`. |
| **Deprecated aliases** | `PortableSequence`, "director sequence" (old format), "resolved sequence". |
| **Status** | `planned` — see UL-2. |

### 2.2 `SequenceTemplate`

| | |
|---|---|
| **Canonical** | `SequenceTemplate` |
| **Definition** | The AI Planner's output for a session: a parameterised pattern with `${variable}` placeholders that the Executor later fills. Templates are session-scoped and short-lived (7-day TTL). |
| **Type / shape** | `interface SequenceTemplate { id, sessionId, category, variables[], steps[], holdHint, ... }`. |
| **Where it lives** | `sequenceTemplates` Cosmos container. |
| **Deprecated aliases** | "planner sequence", "draft sequence". |
| **Status** | `done` — keep name as-is. |

### 2.3 `LibrarySequence`

| | |
|---|---|
| **Canonical** | `LibrarySequence` |
| **Definition** | An operator-authored reusable pattern stored independently of any session. The Planner may include them as inspiration when generating `SequenceTemplate`s for a session. |
| **Type / shape** | Same shape as `SequenceTemplate` but with a different lifecycle (no TTL, owner is a user). |
| **Where it lives** | `operatorSequences` Cosmos container (planned, not implemented). |
| **Deprecated aliases** | "operator sequence" (acceptable as English, but prefer `LibrarySequence` in code/types), "saved sequence". |
| **Status** | `planned` — adopt this name when the feature ships; do **not** ship under any other name. |

> **Reviewer rule:** If a PR uses "sequence" without a qualifier and the meaning is not unambiguous from context, ask for one of the three canonical names.

---

## 3. Director vs RaceDirector

`Director` is overloaded with iRacing's `Race Director` broadcast camera tool. The canonical separation is:

### 3.1 `Director`

| | |
|---|---|
| **Canonical** | `Director` (proper noun — the on-premise app) |
| **Definition** | The Electron application from `margic/director` that runs on a Media/Director Rig. Polls Race Control for sequences and executes them against OBS, iRacing, and Discord. |
| **Type / shape** | App, not a type. |
| **Where it lives** | `margic/director` repository; `/api/director/v1/...` endpoints; `DirectorCheckin` type. |
| **Deprecated aliases** | "Race Director app" (ambiguous with the iRacing tool), "Director Loop" (acceptable as a section name only — it is the name of the polling loop *inside* the Director). |
| **Status** | `done`. |

### 3.2 `RaceDirector`

| | |
|---|---|
| **Canonical** | `RaceDirector` (one word, capitalised — proper noun for the iRacing tool) |
| **Definition** | iRacing's built-in broadcast camera tool — the in-sim feature that picks which car to show on the broadcast camera. The `broadcast.showLiveCam` intent ultimately drives the RaceDirector. |
| **Type / shape** | External system; referenced by intent payloads and OBS scene names. |
| **Where it lives** | `broadcast.showLiveCam` payload semantics, `raceDirectorScene` field. |
| **Deprecated aliases** | "Race Director" (with a space — easily confused with the Director app), "iRacing director", "director scene" (when meaning the OBS scene that *shows* the RaceDirector feed — use `raceDirectorScene`). |
| **Status** | `planned` — rename `directorScene` → `raceDirectorScene` (UL-3). |

### 3.3 `raceDirectorScene`

| | |
|---|---|
| **Canonical** | `raceDirectorScene` |
| **Definition** | The OBS scene name that displays the iRacing RaceDirector camera feed. There is at most one per session. Distinct from `FocusEntry`-specific onboard scenes. |
| **Type / shape** | `string` (an OBS scene name). |
| **Where it lives** | `RaceSession.raceDirectorScene` (currently `directorScene`); template variable `${raceDirectorScene}`. |
| **Deprecated aliases** | `directorScene`, "Race Director scene", "Director scene". |
| **Status** | `planned` — UL-3. |

---

## 4. Cameras and scenes

iRacing exposes **camera groups** (semantic groupings like "TV1", "Cockpit") and OBS exposes **scenes** (named compositions). They are unrelated and must never be conflated.

### 4.1 `cameraGroupName`

| | |
|---|---|
| **Canonical** | `cameraGroupName` |
| **Definition** | The human-readable label for an iRacing camera group (e.g. `"TV1"`, `"Blimp"`, `"Cockpit"`). For display and logging only. |
| **Type / shape** | `string`. |
| **Where it lives** | `RaceSession.cameraGroups[].name`, broadcaster UI, log messages. |
| **Deprecated aliases** | "camera name", bare "cameraGroup" when the value is a string. |
| **Status** | `planned`. |

### 4.2 `cameraGroupNum`

| | |
|---|---|
| **Canonical** | `cameraGroupNum` |
| **Definition** | The numeric iRacing camera-group identifier (e.g. `4`, `5`, `9`). **This is the value `broadcast.showLiveCam` requires at runtime.** |
| **Type / shape** | `integer`. |
| **Where it lives** | `RaceSession.cameraGroups[].groupNum`, `broadcast.showLiveCam.payload.cameraGroupNum`, template variables `${cameraGroupNum}` and `${competitorCameraGroupNum}`. |
| **Deprecated aliases** | `cameraGroup` (string-or-number ambiguous), `camGroup`, `groupNum` (ambiguous out of context). |
| **Status** | `planned` — UL-3. |

> **Rule:** Any payload that historically used a string camera-group name must be migrated to the numeric `cameraGroupNum`. If a string is encountered post-migration, fail loudly.

### 4.3 `obsSceneName`

| | |
|---|---|
| **Canonical** | `obsSceneName` (full) / `sceneName` (in payloads where the OBS namespace is obvious from `intent: "obs.switchScene"`) |
| **Definition** | The exact, case-sensitive name of an OBS scene as configured in the on-premise OBS instance. |
| **Type / shape** | `string`. |
| **Where it lives** | `obs.switchScene` payload, `FocusEntry.obsSceneName`, `RaceSession.obsScenes[]`, `raceDirectorScene`. |
| **Deprecated aliases** | `obsSceneId` (it is not an id), "scene name" without `obs` qualifier in prompts where iRacing camera context is also present. |
| **Status** | `in-progress`. |

> **Rule:** Never use bare "scene" in a prompt when both OBS and iRacing camera concepts are present in the same paragraph. Always qualify (`OBS scene` or `iRacing camera group`).

---

## 5. Context

`context` is overloaded between a request payload, AI-prompt context, and English prose. The fix is to keep the type names but qualify the prose.

### 5.1 `RaceContext`

| | |
|---|---|
| **Canonical** | `RaceContext` |
| **Definition** | The live telemetry + state snapshot the Director sends on every `/sequences/next` poll. Includes leaderboard, flags, battles, pitters, and current OBS scene. |
| **Type / shape** | `interface RaceContext { sessionType, drivers[], battles[], pitting[], focusedCarNumber, currentObsScene, ... }`. |
| **Where it lives** | `NextSequenceRequest.raceContext`. |
| **Deprecated aliases** | "session context", "AI context", "Director context". In prose use **"live race context"** or **"Director snapshot"** when disambiguation is needed. |
| **Status** | `done`. |

### 5.2 `AISnapshot`

| | |
|---|---|
| **Canonical** | `AISnapshot` |
| **Definition** | The composite object the Executor assembles to send to Gemini: `RaceContext` + active templates + pending commands + recent `raceEvents`. |
| **Type / shape** | Internal type in `api/src/lib/sequence-executor.ts`. |
| **Where it lives** | Executor only. Never appears in API responses. |
| **Deprecated aliases** | "prompt context", "executor context". |
| **Status** | `done`. |

---

## 6. SimRaceCenter and BroadcastCenter

`center` is overloaded between the **brand** ("SimRaceCenter") and the **multi-tenant unit** (a `Center` document in Cosmos).

### 6.1 `SimRaceCenter`

| | |
|---|---|
| **Canonical** | `SimRaceCenter` |
| **Definition** | The product / brand / organisation. Use in marketing, blog posts, the landing page, README, and prose. |
| **Where it lives** | `content/blog/`, `src/app/page.tsx`, README. |
| **Deprecated aliases** | "Sim Race Center" (with spaces), "the Center", "SRC" (only acceptable as an internal abbreviation in code comments). |
| **Status** | `in-progress`. |

### 6.2 `BroadcastCenter`

| | |
|---|---|
| **Canonical** | `BroadcastCenter` |
| **Definition** | The multi-tenant unit: a logically isolated broadcasting organisation with its own sessions, drivers, sequences, and access control. SimRaceCenter is the first (and currently only) `BroadcastCenter`. |
| **Type / shape** | Cosmos document in `centers` container. TypeScript `interface BroadcastCenter` (currently `Center`). |
| **Where it lives** | `centers` Cosmos container; `centerId` foreign keys throughout. |
| **Deprecated aliases** | `Center` (bare), `CenterConfig`. |
| **Status** | `planned` — UL-2. |

### 6.3 `centerId`

| | |
|---|---|
| **Canonical** | `centerId` |
| **Definition** | The id of a `BroadcastCenter`. Keep the field name short, but in docs always qualify as "BroadcastCenter ID". |
| **Type / shape** | `string` (UUID). |
| **Status** | `done` — name kept; docs updates pending. |

---

## 7. Quick reference: rename table

The following table summarises every rename in this glossary. Use it as the checklist when reviewing a PR.

| Surface | Old | New |
|---|---|---|
| TypeScript type | `RaceSessionDriver` / `SessionDriver` | `SessionEntry` |
| TypeScript type | `PortableSequence` | `BroadcastSequence` |
| TypeScript type | `Driver` (as racer profile) | `RacerProfile` |
| TypeScript type | `Center` / `CenterConfig` | `BroadcastCenter` / `BroadcastCenterConfig` |
| Field | `RaceSession.drivers[]` | `RaceSession.entries[]` |
| Field | `RaceSession.directorScene` | `RaceSession.raceDirectorScene` |
| Field | `RaceSession.cameraGroups[].name` | `RaceSession.cameraGroups[].cameraGroupName` |
| Field | `RaceSession.cameraGroups[].groupNum` | `RaceSession.cameraGroups[].cameraGroupNum` |
| Template var | `${targetDriver}` | `${targetCarNumber}` |
| Template var | `${secondDriver}` | `${competitorCarNumber}` |
| Template var | `${cameraGroup}` | `${cameraGroupNum}` |
| Template var | `${competitorCameraGroup}` | `${competitorCameraGroupNum}` |
| Template var | `${directorScene}` | `${raceDirectorScene}` |
| Cosmos container | `portableSequences` | `sessionSequences` (rename happening independently — see session-sequences refactor) |
| Cosmos container | `operatorSequences` | keep the container name, but the documents are `LibrarySequence`s |
| Prompt prose | "our drivers", "SimRaceCenter driver", "team driver", "A-list", "primary driver" | **focus driver** |
| Prompt prose | "field driver", "non-team car", "background car" | **field car** |
| Prompt prose | "Race Director" (the iRacing tool) | **RaceDirector** |
| Prompt prose | "context" (when ambiguous) | "live race context" or "Director snapshot" |

---

## 8. Enforcement

The plan in [`features/ubiquitous-language-plan.md`](features/ubiquitous-language-plan.md) sequences the rollout. Until each rename lands, both names will coexist; once a rename lands, the deprecated alias becomes a review blocker.

Lightweight enforcement options (to evaluate, not mandatory at v1):

- A `scripts/lint-glossary.sh` grep-based check that fails CI if a deprecated alias appears in `src/`, `api/src/`, `docs/`, or `content/blog/`.
- A `CONTRIBUTING.md` paragraph linking here as the source of truth for terminology.
- A PR-template checkbox: *"I have used terms from `docs/glossary.md` and not introduced deprecated aliases."*

## 9. Change process

1. Propose additions or changes via a PR that edits **this file**.
2. Tag at least one Director-app maintainer if the change affects the cross-repo contract (any term in §2, §3, §4, §6).
3. Update the plan document in lockstep.
4. Once merged, the new term is *immediately* canonical; deprecated aliases enter the review-blocker list.
