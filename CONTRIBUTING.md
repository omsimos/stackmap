# Contributing to stackmap

Thanks for helping. Bug reports, diagrams that render badly, and fixes are all welcome. For a new feature or a
change to the diagram schema, open an issue first so we can agree on the shape before you build it.

Two ideas shape most decisions, so they're worth knowing up front:

- **The agent writes the diagram; stackmap never guesses.** Layout, validation and delivery are deterministic: the
  same JSON always gives the same HTML, byte for byte. Anything that needs judgement belongs in the skill's
  guidance ([`skill/`](skill/)), not in code.
- **The viewer is read-only.** It explores a diagram but never edits it. Every change goes through the agent
  editing the JSON.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security issue, see
[SECURITY.md](SECURITY.md); please don't open a public issue for it.

## Setup

You need [Bun](https://bun.sh) 1.3 and Node ≥ 22.12 (tests run on Node).

```bash
bun install
bun run test && bun run typecheck && bun run build   # unit tests, types, viewer template + CLI bundle
```

| Package | What it does |
|---|---|
| `packages/core` | types, theme tokens, card metrics, headless text measurement (generated Geist metrics), samples |
| `packages/schema` | Zod schema → `stackmap.schema.json`, the validator and its diagnostics |
| `packages/layout` | ELK wrapper and stackmap's own lane and sequence layout: diagram → absolute geometry |
| `packages/viewer` | React viewer, built into one self-contained HTML template |
| `packages/cli` | `@omsimos/stackmap`: validate · deliver · serve (the only published package) |
| `skill/` | the agent skill that `npx skills add` installs: `SKILL.md`, the schema reference, examples |
| `site/` | `@stackmap/site`: the website (Next.js), deployed on Vercel; never published |

To work on the viewer, `bun run --filter @stackmap/viewer dev` serves it with its sample diagrams.
To work on the website, build the viewer once (`bun run --filter @stackmap/viewer build`), then run `bun run --filter @stackmap/site dev`.

## Checks

CI runs everything below on every pull request.

```bash
bun run test && bun run typecheck && bun run build
cd packages/viewer && bunx playwright test   # viewer e2e and visual regression
cd packages/cli && bunx playwright test      # delivered-file and live-serve e2e
```

- **Visual baselines** are Linux-only, because fonts rasterise differently on each OS, so the visual tests are
  skipped locally on macOS and Windows. When you change how something looks, regenerate them with
  `bun run --filter @stackmap/viewer visual:update` (Playwright's Linux image, in Docker), or run the CI workflow
  by hand with *update-visual* ticked and download the `visual-baselines` artifact. Commit the new images in a
  `test(viewer): update visual baselines for …` commit.
- **Font metrics:** after a font change, `bun run --filter @stackmap/viewer metrics:gen`.
- **Schema changes:** edit `packages/schema/src`, then run `bun run --filter @stackmap/schema schema:emit`. It
  regenerates `stackmap.schema.json`, the copy under `skill/references/` and `skill/references/schema.md`, and
  the tests fail until you do. Update any affected examples in `skill/examples/`.

## Branches and pull requests

- Branch from `staging`, named after the kind of change: `feat/…`, `fix/…`, `docs/…`, `chore/…`.
- Open the pull request against **`staging`**. `main` only takes release merges from `staging` (and the occasional
  hotfix).
- Keep a pull request to one change. Say what changed and why; add a screenshot for anything visual.
- Any merge method works. If you squash, the PR title becomes the commit, so it follows the same rules below.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org), and CI checks every commit in a pull
request and its title. The messages decide the next version and fill the release notes, so write them for
the people reading those notes.

```
feat(viewer): route between two nodes
fix(schema): warn when a time band covers messages it doesn't list
docs(skill): map Mermaid sequence diagrams
```

- **Types:** `feat` (a minor release), `fix` and `perf` (a patch), and `docs`, `test`, `refactor`, `build`, `ci`,
  `chore`, `style` (no release).
- **Scopes** are optional; use the package or area: `viewer`, `schema`, `layout`, `core`, `cli`, `skill`, `readme`, `site`.
- **Website changes** (`site/`) use `docs(site): …`. `feat`, `fix`, `perf` and `revert` with the `site` scope are rejected, because they would publish a new npm version.
- **Subject:** imperative and lower case, with no full stop.
- **Breaking changes:** add `!` after the type (`feat(schema)!: …`) or a `BREAKING CHANGE:` footer. A change is
  breaking when a diagram that validated before no longer does, or when the CLI's flags, output or exit codes
  change. While stackmap is below 1.0, a breaking change makes a minor release.

## Releases

Releases are automated with [semantic-release](https://semantic-release.org) (`release.config.mjs`), and the CI
workflow's `release` job runs them after the checks pass.

- **Release candidates:** every push to `staging` with a `feat`, `fix` or `perf` commit since the last release
  publishes `x.y.z-rc.N` to npm under the `rc` tag, with a GitHub prerelease. Try one with
  `npx @omsimos/stackmap@rc`.
- **Releases:** merging `staging` into `main` with a **merge commit** publishes `x.y.z` under `latest`, with a
  GitHub release. Don't squash or rebase this merge: the release candidates' tags must stay in `main`'s history,
  or the next version is miscounted.
- **The version is pinned in the repo:** the skill runs an exact CLI version (`npx -y @omsimos/stackmap@x.y.z`),
  and the JSON Schema id and the examples name it too. On a release, `scripts/set-version.mjs` updates them all,
  the bot commits `chore(release): x.y.z [skip ci]` to `main`, and then merges `main` back into `staging`.
  Release candidates only change the published package, so the repo keeps the last release's version between
  releases. Never edit these pins by hand.
- **The website** deploys to production from CI, not from Vercel's push hook: after the `release` job, the
  `deploy-site` job calls a Vercel Deploy Hook (the `VERCEL_DEPLOY_HOOK_MAIN` secret), which builds `main`'s tip.
  That way the release commit, not the merge before it, is what goes live. Pull requests and `staging` still get
  Vercel previews on push.
