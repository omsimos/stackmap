# Authoring contract

How to model a system as a stackmap diagram. The [schema reference](schema.md) says what is *allowed*; this says what is *good*. `stackmap validate` enforces the hard rules and tells you exactly what to fix.

> Adapted in part from [archify](https://github.com/tt-a1i/archify)'s authoring and repository references — MIT, Copyright (c) 2026 tt-a1i (Archify), Copyright (c) 2025 Cocoon AI. The full license text is in [LICENSE](../LICENSE).

## Composition

- **Show the path that answers the question.** Start from the entry point the user cares about (a client, an API, an event source) and follow it to where state lives or effects land. Add branches only when they change the answer.
- **One node per runtime unit the reader must distinguish.** Three replicas of the same service are one node unless the question is about the replicas. A library is not a node; the process that runs it is — unless the user is asking about the code's structure (packages, modules), in which case packages are the nodes and edges are the calls between them.
- **Edge direction depends on the kind.**
  - `architecture`: from the **initiator** to what it calls or uses — `api → db` even when the api only reads. Queues and streams are the exception: draw `producer → queue → consumer` (the queue delivers), even though consumers technically pull.
  - `dataflow`: the direction **data moves** — `db → cdc → kafka → job → store`; a reader of a store is `store → reader`.
- `kind: "async"` for queues, events, fire-and-forget and callbacks — it renders dashed. Don't use it for "happens at build time" or "optional"; say that in a label or in the node's subtitle.
- `kind: "return"` for a reply, a roll back or a retry that loops back to an earlier step — it renders dotted, and layout never lets it push its target to a later column. Mark every reply this way: a client that sends a request and shows the response (`picker → api`, `api → feed`) only stays upstream of the API when the response is a `return`.
- **`tone`** marks the few edges the reader must tell apart: `main` for the happy path (drawn in ink), `security` for a trust crossing or a policy check, `error` for a failure path. Leave the rest untoned; a diagram where everything has a tone has none.
- **Edge labels** (≤ 24 chars) only where the relationship isn't obvious from the two ends: a protocol (`gRPC`), a verb (`enqueue`), a topic. Most edges need none — except in sequences, where every message is labelled. In an architecture or dataflow, keep **one edge per direction** between two nodes: fold both relationships into one label (`reads, writes`).
- **Busy cards.** Edges of one style leaving (or entering) a card merge into one trunk, and each label sits by the card it names; a tone or line style of its own gets its own line. A card with more than ~6 edges (a request handler that calls everything) reads best when only the edges whose target doesn't explain them carry a label, and when a view per path (`Routing`, `Persistence`) lets the reader follow one question at a time.
- **Node order is flow order.** List nodes the way the request travels — entry point first, stores and third parties last. The layout keeps that order among siblings, and where the edges form a loop it treats the earliest node as the start.
- **Direction.** `RIGHT` (default) reads as a request path and suits 2–4 stages. Prefer `DOWN` for tiered or grouped systems (edge → app → data) and for anything with more than ~5 stages; it avoids long wrap-around edges.
- **Groups** are boundaries a reader should see: tiers, trust zones, VPCs, clusters, teams. Nest with `parent`. A group with one node is usually noise.
- **Stages** (`phases` with `nodes`) in `architecture` and `dataflow` are an ordered pipeline (sources → ingest → process → store → consume): each stage is drawn as a band, in flow order. Stage members must be ungrouped; use stages *or* groups for a node, not both.
- **Notes** are the diagram's takeaways (`notes: [{ "title": "Stop conditions", "items": [...] }]`), listed in the inspector. Two or three, a few short items each; they say what the picture means, not what it shows.
- **Views** are named focus sets for the tabs above the canvas ("Data tier", "Checkout path"): the view dims everything else and fits its members. Add one when the diagram answers more than one question; the first tab is always Overview.

## Size

A diagram is read on one screen. Aim for **~10–40 nodes**; past that, cards get too small at fit and the picture stops answering a question. For a larger system, deliver an **overview** diagram (subsystems as single nodes) plus **one diagram per subsystem** in sibling folders (`.stackmap/<system>-overview/`, `.stackmap/<system>-payments/`, …). Views don't reduce size — every node is still drawn. `validate` warns past 60 nodes. The schema's hard caps (500 nodes, 2000 edges) are a safety limit, not a target; if you hit one, split rather than delete.

## From Mermaid

Read Mermaid for topology and meaning, then write fresh stackmap JSON — don't mechanically copy its styling.

| Mermaid | stackmap |
|---|---|
| `flowchart LR` / `graph LR` | `direction: "RIGHT"` |
| `flowchart TD` / `TB` | `direction: "DOWN"` (`BT`/`RL` aren't supported — use the nearest) |
| node `id[Label]`, `id((Label))`, `id[(Label)]` | node; lowercase the id (`coreApi` → `core-api`); shape hints the `type` (`[( )]` is usually a database/storage) |
| `A --> B` | edge `from: "a", to: "b"` |
| `A -.-> B`, `A -.->|label| B` | edge with `kind: "async"` (and `label`) |
| `A -->|label| B` | edge with `label` (≤ 24 chars) |
| `subgraph x [Title] … end` | group `{ "id": "x", "label": "Title" }`; nodes inside get `group: "x"` |
| nested `subgraph` | group with `parent` |
| an edge to or from a subgraph id | an edge to its **entry node** inside the group — a group is not a node, don't add one |
| `<br/>` detail in a label | `subtitle` or a card row |
| `classDef`, `style`, `linkStyle` | ignore |

A Mermaid `sequenceDiagram` becomes `kind: "sequence"`:

| Mermaid | stackmap |
|---|---|
| `participant A as Label`, `actor A` | node (participant) in the order declared; `actor` is usually a `client` |
| `A->>B: text`, `A->B: text` | edge `from: "a", to: "b", label: "text"` (a call) |
| `B-->>A: text`, `B-->A: text` | the same with `kind: "return"` |
| `A-)B: text` | the same with `kind: "async"` |
| `A->>A: text` | a self-call (`from` and `to` the same) |
| `rect … end`, a `Note over` spanning a stretch | a phase with those messages in `edges` |
| `activate` / `deactivate`, `+` / `-` | leave out: bars are derived from calls and replies |
| `alt`, `opt`, `loop`, `par` | not supported: draw the main case and say the others in `notes` |

## Workflows and lifecycles

Both are drawn as **swimlanes**: `lanes` are full-width rows in the order you list them, and stackmap picks the columns from the edges (a step's successor in the same lane moves right; a hand-off to another lane may drop straight down). Every node needs a `lane`.

- **Lanes** are owners or phases of attention: *Developer, CI, Release governance*; *Lifecycle phases, Interruptions, Terminal exits*. Put failure and recovery in their own lane with `"tone": "exception"`. Four to six lanes read well.
- **Phases** (`phases` with `nodes`) label the columns above the lanes: *Change → Build and verify → Promote*. Each phase starts after the previous one ends, so list them in order and put each node in at most one.
- **Groups** in a lane frame a few neighbouring steps (*Blocking checks*); they can't span lanes or nest. `"tone": "security"` on a group marks a policy stop.
- **Cards are compact:** `title`, `subtitle`, `brand` and a short `tag` pill (*human gate*, *owner: on-call*, *15 min stable*) — no rows, stats, footer or CTA. Put detail in `evidence` notes.
- **Workflow nodes** use the component types, for who or what does the step: `client` for a person's step (open a pull request, merge), `service` for your own automation (a CI job, a script), `external` for a third party (a package registry, a hosting provider), and `security` for a gate that can block the flow (required checks, an approval). An outcome that ends or skips the flow (*No release*, *Build skipped*) takes the type of what decided it, sits in the exception lane, and says why in its `tag`.
- **Lifecycle nodes** use the state types:

| type | use for |
|---|---|
| `start` | where the thing begins (drawn with an initial marker) |
| `active` | work in progress: building, executing, rolling back |
| `waiting` | paused on something outside: approval, input, a timer |
| `decision` | a check that sends the thing one way or another |
| `success` | a good end, or a good stop along the way |
| `failure` | an error or a bad end |
| `neutral` | anything else |

A `success` or `failure` state with no outgoing transition is drawn as an end state. A retry is a `return` edge back to the state it retries.

## Sequences

One scenario, told in time. `nodes` are the participants, left to right in the order you list them; `edges` are the messages, top to bottom in array order. stackmap spaces the lifelines for the labels and draws the activation bars itself — never give positions.

- **Participants:** three to eight. Order them the way the request travels (caller first, stores and third parties last) so most arrows point right.
- **Messages:** label every one, briefly (`GET /dashboard`, `read cache`, `202 + job id`). A call is plain; `"kind": "return"` is its reply, from the callee back to the caller, after it; `"kind": "async"` is fire-and-forget. A message from a participant to itself is a self-call (drawn as a loop).
- **Activation bars** follow from the messages: a call opens a bar on the callee, and its reply closes it. A call that arrives while the callee is waiting on its own call (a callback) nests a bar inside. A bar nobody closes ends where its participant was last busy (sending or receiving) once someone else calls it, or at its last message. A reply that answers nothing is a warning (`semantics/unmatched-return`).
- **Phases** (`phases` with `edges`) band stretches of time: *Request, Fallback, Response*. List each band's messages: a band runs from its first to its last message (anything in between it doesn't list is a warning), and bands must follow each other.
- `tone` works as elsewhere: `main` for the happy path, `security` for auth checks, `error` for retries and failures.
- Cards are compact (title, subtitle, brand, tag). No groups or lanes.

## Compact cards

`"density": "compact"` gives an `architecture` or `dataflow` diagram the compact cards workflows use (title, subtitle, brand, tag). Use it for long chains (more than ~5 stages), overviews and summaries, where full cards would make the diagram too small to read at fit; keep full cards when rows, stats and footers carry the answer.

## Node types and colour

`type` sets the card colour (never the brand). Pick by role:

| type | use for |
|---|---|
| `client` | browsers, mobile apps, CLIs, SDKs — anything a user drives |
| `gateway` | load balancers, API gateways, CDNs, edge routers, ingress |
| `service` | your own processes: APIs, workers, functions, jobs |
| `database` | relational/document/graph stores that are the system of record |
| `cache` | Redis/Memcached-style caches, session stores |
| `queue` | brokers, streams, topics, task queues |
| `storage` | object/blob/file stores, data lakes, warehouses' storage layers |
| `external` | third-party APIs and SaaS you don't run |
| `security` | auth providers, IAM, secrets managers, WAFs |

`brand` puts a logo in the icon tile — only a slug from the [brand list](schema.md#brand-slugs); anything else falls back to the type icon with a warning.

## Cards

A full card (architecture and dataflow) is a fixed 280px-wide tile; a compact card is 176px wide (title ≈ 15 characters, subtitle ≈ 17, tag ≈ 14; the diagnostic's `maxChars` is exact). Only `title` is required; add sections when they carry information the reader needs at a glance.

- `title` — the name people use (`orders-api`, `Orders`). `subtitle` — what it is (`PostgreSQL cluster`, `Payments API`).
- `rows` (≤ 6) — key/value facts: size, port, runtime, schedule. `mono: true` for ports, IPs, paths. One row per label: two rows under the same label (a warning) usually means one fact split in two — merge the values (`file: hard · 16k: standard`).
- `stats` (≤ 3) with `statsNote` — counts that matter (replicas, shards, partitions).
- `footer` — two short facts, left and right (region, protocol, ownership), with optional `icon`: `region`, `secure`, `members`.
- `cta` — a link out (`href`, http(s) only): a dashboard, a runbook.

Text never wraps; it truncates, and truncation is a validation **error** (`card-fit/overflow`) measured with the real font. Typical budgets for ordinary words: title ≈ 28 characters, subtitle ≈ 32, a row label + value together ≈ 35 (value alone ≤ 21), stat values ≈ 5 and labels ≈ 8 with three tiles (≈ 16 with two), stats note ≈ 36, footer items ≈ 14 with an icon and ≈ 17 without, CTA label ≈ 32. Wide letters (`W`, `M`) and non-Latin scripts fit fewer; the diagnostic gives the exact `maxChars` for your text. Put long detail in `evidence` notes instead.

## Repository diagrams

When the diagram must explain a real codebase, the source is the authority for responsibilities, calls, boundaries and persistence.

1. **Map the slice.** Use manifests, entry points, route registrations, deployment/infra config (Dockerfiles, compose, Terraform, k8s, serverless configs) to find the runtime units. Read the entry, config and modules relevant to the request; follow imports and call sites until each responsibility reaches its real input, output or side effect. Read a connected slice, not the whole repo.
2. **Trace ownership.** Draw an edge only where you saw the call, publish, read or write at a call site (or the config that wires it). A package that is installed but never called on the normal path is not an edge. Distinguish the service that requests work from the worker that executes it and the store that receives the bytes.
3. **Record evidence while reading.** Put `evidence: [{ "file": "src/orders/db.ts", "line": 42, "note": "writes orders" }]` on nodes, with paths relative to the repo root (or the project root if it isn't a git repo). Notes are shared with the diagram: never quote secrets or internal hostnames in them. Edges have no `evidence`: cite the line that makes an edge on the node that calls, publishes or writes, with a `note` naming the target (`publishes to npm`), or in the diagram's `notes` when no single node owns it.
   **Links (`source.url`)** — set it only when all of these hold, otherwise omit `source` (evidence still shows as `file:line`):
   - the remote is on **GitHub or GitLab** (`git remote get-url origin`). Convert `git@github.com:owner/repo.git` or `https://github.com/owner/repo.git` to `https://github.com/owner/repo`; drop any `user:token@` part.
   - the commit is **on the remote**: `git branch -r --contains HEAD` prints something. Otherwise use the newest pushed commit, `git merge-base HEAD origin/HEAD` (without an `origin/HEAD`, use the default branch, such as `origin/main`), and cite only files unchanged since it: `git diff --quiet <that sha> -- <files…>` exits 0.
   - use the commit sha, not a branch: `https://github.com/<owner>/<repo>/blob/<sha>` (GitLab: `https://gitlab.com/<group>/<repo>/-/blob/<sha>`).
   - for a file with uncommitted changes (`git status --short`), leave out `line` — its numbers won't match the linked commit.
4. **Name uncertainty.** If you couldn't confirm something (durability, who reads a table), say so in the evidence note or your report rather than drawing it as fact.

Stop exploring when every requested responsibility and relationship is backed by source; there is no node or citation count to reach.

## Repairs that don't converge

A fix that brings back the same diagnostic twice means the fix is wrong, not the validator. Re-read the diagnostic's `subject` and `evidence`, and prefer a different `allowedFixes` entry. After two rounds with no fewer errors, stop and report (see the stop rule in SKILL.md).
