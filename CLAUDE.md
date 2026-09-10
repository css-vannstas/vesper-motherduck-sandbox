# CLAUDE.md

## Read first

Read `README.md` before starting any work here. If the task touches manifests, packages, or deployment, also read the relevant linked doc: `AGENTS.md`, `docs/blueprint-yml-reference.md`, `docs/repository-reference.md`, `docs/setup-your-repository.md`, `docs/adopt-existing-resources.md`, `docs/guides-as-code.md`, `docs/github-action.md`, or `docs/tooling-and-schema-versioning.md`.

## What this repository is

This is a **MotherDuck Blueprints customer deployment repository** — it consumes the Blueprints tool at a pinned version (`v0.5.0`; see `Makefile` and the workflow files), it is **not** the Blueprints product source. Treat CLI/schema/deploy-logic bugs as out of scope here; they belong upstream in `motherduckdb/motherduck-blueprints`. The `template` git remote points there for reference only — never push to it.

## Package and manifest conventions

- `motherduck.yml` is the single root catalog/policy file: it globs in packages (`flights/**/blueprint.yml`, `dives/**/blueprint.yml`, `guides/**/blueprint.yml`, `roles/**/blueprint.yml`, `projects/**/blueprint.yml`, `blueprints/**/blueprint.yml`) and declares `targets` (`preview`, `prod`; no `staging` here).
- Every package is one directory holding one `blueprint.yml` plus its source. In typed roots (`flights/`, `dives/`, `guides/`, `roles/`), the directory name must equal the blueprint's lowercase `name`, and only that root's permitted resource groups may be declared. `projects/`/`blueprints/` allow any combination.
- Producers declare `outputs.<key>.share`; consumers declare `inputs.<key>: {blueprint, output}`. Keep source files inside their own package — never move executable source into `shared/`.
- Don't hand-edit `.github/workflows/*`, `schemas/`, or `.dive-preview/` to add a package — those are support/tooling files, updated via `make upgrade`. Note: `deploy_blueprints.yaml` and `cleanup_preview_blueprints.yaml` currently call localized copies of their reusable workflows rather than the upstream pinned tag `blueprints_doctor.yaml` still uses — preserve that as-is unless the task is specifically about reconciling it.

## Adopt before you create

Before writing a manifest for something that might already exist in MotherDuck, follow `docs/adopt-existing-resources.md`: inventory owner/ID/version/schedule/access first, then use `md-blueprints import` to produce a disabled, UUID-bound package rather than a fresh one. Imported resources start with `deploy: false`; enabling deployment is a separate, explicit, reviewed edit.

## Keep secrets and local state out of git

- Never commit `MOTHERDUCK_TOKEN`, other credentials, or values pulled from a live MotherDuck account.
- Respect `.gitignore` (`.env`, `.dive-preview/.env`, `.venv/`, `node_modules/`, `__pycache__/`, `.pytest_cache/`, `*.egg-info/`, `.vs/`, etc.) — if a task needs a new local-only file, extend `.gitignore` rather than committing it.
- Exported/imported packages can carry hard-coded credentials from the source system — inspect `src/` files before committing anything produced by `make export` or `md-blueprints import --write`.

## Change discipline

- Preserve any existing uncommitted or unrelated changes already in the working tree — never discard, stash, or overwrite them as a side effect of an unrelated task.
- For anything beyond a trivial one-line fix, state a short plan before making broad or multi-file changes.
- Work in small, reviewable units — one package or one concern per change, not sweeping edits across unrelated packages.
- Run `make validate` (and `make preview-smoke <name>` for a changed Dive) before calling a change done, and inspect `git status`/`git diff` to confirm only the intended files changed.

## Git and deployment guardrails

- Never run `git commit`, `git push`, open a pull request, or trigger a deploy/plan/cleanup command against MotherDuck unless explicitly asked for that specific action in that message.
- Never take any action against the `prod` target without separate, explicit approval, even if a preview deployment was already approved. In this repository `prod` and `preview` share the same GitHub Environment and identity — there is no infrastructure-level barrier protecting production, so treat every prod-target action as high-risk by default.
