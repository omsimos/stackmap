---
name: stackmap
description: Turn a system into an explorable architecture, data-flow, workflow, lifecycle or sequence diagram, delivered as one offline HTML file with a topology-dashboard look (dark and light), search, trace, routes, guided views, presentation mode and image/video export. Use when the user asks to diagram, map, visualize or explain the architecture, services, infrastructure, dependencies, data pipeline, process, runbook, release flow, state machine or request sequence of a codebase or of a described system, or to update such a diagram.
license: MIT
metadata:
  version: "0.6.0"
  author: hyamero
  based_on: tt-a1i/archify (MIT)
---

# stackmap

You write a typed diagram JSON. `stackmap` validates it, lays it out (you never give coordinates) and delivers a single self-contained HTML viewer. The viewer is read-only: every change goes through you editing the JSON.

## The CLI

Run it as one literal command (each shell call starts fresh, so don't rely on variables set earlier):

```bash
npx -y @omsimos/stackmap@0.6.0 validate <diagram.json> --json
npx -y @omsimos/stackmap@0.6.0 deliver  <diagram.json> --open
npx -y @omsimos/stackmap@0.6.0 serve    <diagram.json>   # optional live preview; see below
```

If the environment variable `STACKMAP_BIN` is set, it is the path of a stackmap executable: use `"$STACKMAP_BIN" validate …` (quoted, exactly like that) instead of `npx …`.

Exit codes: **0** ok (warnings allowed) · **1** the diagram has errors · **2** usage, file or internal error. `validate --json` always prints one JSON object `{ "ok", "diagnostics" }` on stdout. **If you get exit 1 with no JSON on stdout, the CLI never ran** (npm/network/install problem): report that to the user and don't touch the diagram.

## Where files go

Unless the user names a location, each diagram lives in `.stackmap/<slug>/` under the working directory: `diagram.json`, and `diagram.html` which `deliver` writes next to it. An edit request for an existing diagram reuses its folder and edits `diagram.json` in place — never start over for an edit.

## Steps

1. **Pick the kind.**
   - `architecture`: the edges are *calls and dependencies* between components (services, stores, infrastructure).
   - `dataflow`: only when the edges are *data moving between stages* (pipelines, ETL/ELT, CDC, event streams, lineage).
   - `workflow`: *steps* done by different owners, in order (a release process, an incident runbook, an agent's tool call). Owners are `lanes`.
   - `lifecycle`: the *states of one thing* and the transitions between them (a job, an order, a deployment). States are nodes with state types.
   - `sequence`: *messages over time* between a few participants, for one scenario (a request with a cache miss, an async job roundtrip). Participants are nodes; the edges are the messages, in time order.
   - If unsure between architecture and dataflow, use `architecture`.
2. **Gather facts.** For a real codebase, follow [Repository diagrams](references/authoring-contract.md#repository-diagrams): every node and edge should be backed by code or config you read. For a described system, use only what the user said plus unavoidable glue; don't invent components. For Mermaid or other diagram text, use the [Mermaid mapping](references/authoring-contract.md#from-mermaid).
3. **Write the complete `diagram.json` once**, following [the authoring contract](references/authoring-contract.md). Field rules and limits: [schema reference](references/schema.md). Shapes: [examples](examples/) — they teach shape, not facts.
4. **Validate** with `validate <path> --json`.
5. **Repair only what the diagnostics name.** Each has a `code`, a `subject` (JSON pointer into your file), a `message`, `evidence` and `allowedFixes`. Apply one of the `allowedFixes` at `subject`; don't restructure unrelated parts. `card-fit/overflow` means the text would be cut off on the card: shorten it to the `maxChars` in its evidence, keeping the meaning (move detail into a row, or into an evidence note on compact cards, which have no rows). Re-run step 4.
   - **Stop rule:** if two consecutive rounds don't reduce the number of errors, stop, keep the last file, and report the remaining diagnostics verbatim instead of guessing.
   - Warnings don't block delivery. Fix the cheap ones (a misspelt brand, a node you forgot to connect); mention the ones you leave.
6. **Deliver** with `deliver <path> --open`: it writes `diagram.html` and opens it in the user's browser. A warning that no browser could be opened is not a failure (a headless or remote machine): the file is written, so give its path. Exit 1: back to step 5. Exit 2: an environment problem — report it; don't edit the diagram to "fix" it.
7. **Check evidence** (repository diagrams): every `evidence[].file` must exist, e.g. `git ls-files --error-unmatch <files…>` from the repo root.
8. **Report** the absolute path of `diagram.html`, the receipt line, and any warnings you left. Offer `serve` for iterating. Don't claim you looked at the rendering unless you did.

## Editing an existing diagram

Read `.stackmap/<slug>/diagram.json`, change only what was asked, then steps 4–8 on the same path. **Keep ids stable:** to rename something, change its `card.title`, not its `id`. If an id truly must change, update every edge (`from`/`to`), view (`nodes`) and group reference to it in the same edit.

## Live preview

`serve` runs until stopped and reloads the page on every save, keeping the last good version when a save is invalid. Start it in the background (it would block your shell) and give the user the printed `http://127.0.0.1:…` URL. It doesn't write `diagram.html`: still run `deliver` when the user wants the file.

## Don'ts

- No coordinates, sizes, colours or styling fields: the schema is strict and rejects them. Layout and colour come from `direction`, `groups`, `lanes`, `phases`, node `type` and edge `tone`.
- Don't colour by brand: `type` sets the colour; `brand` only puts a logo in the icon tile.
- **Never copy secrets** into the diagram: no credentials, tokens, keys, connection strings with passwords, or internal hostnames/IPs from `.env` files or config. The HTML is made to be shared.
- Don't pad the diagram. No node, edge or group count is a target; past ~40 nodes, split (see [Size](references/authoring-contract.md#size)).
- Don't edit the delivered HTML. It is output; the JSON is the source of truth.
