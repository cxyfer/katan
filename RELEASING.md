# Releasing catan

This file is the release contract for the repository. Read it before creating a version tag.
The automation lives in [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml).

## What a release does

Pushing a `vMAJOR.MINOR.PATCH` tag (optionally with a `-PRERELEASE` suffix) runs one workflow that:

1. builds `linux/amd64` and `linux/arm64` and pushes the commit-tagged index,
2. smoke tests that pushed digest — the full API flow on amd64, boot and health checks on arm64, and
3. moves the release tags onto the digest that passed.

It does **not** bump the version, run `pnpm verify`, or create the GitHub Release. Those steps stay
manual on purpose (see [Rules](#rules)).

The workflow runs **only** on a `v*` tag push. Pull requests and pushes to `master` do not build, so
ordinary development consumes no Actions minutes or package storage. There is no manual trigger.

## Image tags

| Git ref | Tags pushed | Notes |
|---------|-------------|-------|
| `v0.2.0` (stable) | `v0.2.0`, `v0.2`, `latest`, `sha-<short>` | Moving tags follow the tag |
| `v0.3.0-rc.1` | `v0.3.0-rc.1`, `sha-<short>` | Pre-release: never moves `v0.3` or `latest` |

Every exact image tag is the Git tag verbatim, so stable and pre-release versions share one
spelling: `v` followed by the version. `latest` is the only tag that is not a version. `sha-<short>`
is per commit and exists for rollback: pin the digest when you need an exact build.

`v0.1.0` predates this rule and was published as `0.1.0`. That tag stays on GHCR and is not removed,
so existing pins keep working. Use `v` for every release after it.

The full image name is `ghcr.io/cxyfer/katan`. It is derived from `github.repository`, so a fork
publishes to its own namespace.

## Rules

1. **The tag must equal the `package.json` version.** `v0.2.0` requires `"version": "0.2.0"`. That
   file is the only copy: `packages/server/build.mjs` stamps it into the bundle at build time, so
   `/healthz` reports the version of the tag that was built. The build job rejects a tag that does not
   match, and the smoke job rejects an image whose health response disagrees with the commit it was
   built from.
2. **A release is its own commit.** Bump `package.json` in a `🔖 release: vX.Y.Z` commit, push it to
   `master`, and tag that commit — not a feature commit that happens to be at the tip. `v0.1.0` is the
   one exception: it was tagged before this contract existed, on a commit whose `package.json` already
   declared `0.1.0`, so there was nothing to bump.
3. **Tag only merged commits.** The workflow file must exist on the tagged commit, so push `master`
   before the tag.
4. **Never move or reuse a published tag.** The tag is the identity of an image. Publish a new patch
   version instead.
5. **Only stable versions move `X.Y` and `latest`.** A pre-release keeps its exact tag and
   `sha-<short>`, and `latest` stays on the last stable build, so a pre-release cannot hijack what
   players pull.
6. **Only tags build.** Merging to `master` publishes nothing, so a Dockerfile problem surfaces when
   the tag is pushed. Run `pnpm verify` (and `docker build .` when the Dockerfile changed) before
   tagging.
7. **The GitHub Release is manual, in the standard format.** Publish it after the image exists, with
   notes scaffolded by [`scripts/release-notes.sh`](scripts/release-notes.sh) and shaped by
   [`.github/release-notes-template.md`](.github/release-notes-template.md). Keep every prose
   paragraph and highlight bullet on one source line — GitHub turns a newline inside a release body
   into a hard break — and run [`scripts/release-notes-lint.sh`](scripts/release-notes-lint.sh) on
   the draft.
8. **GHCR visibility is a repository setting.** A private repository produces a private package, and
   every pull then needs `docker login ghcr.io` (token scope `read:packages`). The package is
   published publicly, so the documentation and the release notes carry no login step; if it goes
   private again, they need the login back.

## Release checklist

### 1. Pre-flight

```bash
git switch master
git pull --ff-only
git status --short          # must be empty

pnpm install --frozen-lockfile
pnpm verify                 # typecheck + tests + build + post-build smoke
```

### 2. Bump the version

The version lives in one file:

| File | What changes |
|------|--------------|
| [`package.json`](package.json) | `"version": "0.2.0"` |

Nothing else carries the version. `packages/server/build.mjs` reads this file and defines
`__CATAN_VERSION__` when it bundles the service, which is what `/healthz` reports.

```bash
git add package.json
git commit -m "🔖 release: v0.2.0"
git push origin master
```

The repository uses gitmoji-style subjects; `🔖 release: vX.Y.Z` matches the existing history.
This commit is what step 3 tags: it carries the version the tag promises, and the build job refuses
a tag whose `package.json` disagrees. A `-rc.N` bump leaves `latest` on the last stable build.

### 3. Tag and push

```bash
git tag -a v0.2.0 -m v0.2.0
git push origin v0.2.0
```

The tag push starts the workflow.

### 4. Verify the image

```bash
gh run list --workflow=docker-publish.yml --limit 5
gh run watch <run-id>

docker buildx imagetools inspect ghcr.io/cxyfer/katan:v0.2.0   # public package: no login needed
```

`imagetools inspect` must list both `linux/amd64` and `linux/arm64`. The workflow already asserts
that `/healthz` reports the version of the commit it built, so this manual check is a second opinion
on the same claim — the tag, the bundle and the image must agree:

```bash
docker run --rm -d --name catan-version-check -p 3411:3000 \
  ghcr.io/cxyfer/katan:v0.2.0
curl -s http://127.0.0.1:3411/healthz      # {"ok":true,"data":{"version":"0.2.0",...}}
docker rm -f catan-version-check
```

The image tag is the Git tag verbatim, so `v0.2.0-rc.3` publishes `ghcr.io/cxyfer/katan:v0.2.0-rc.3`
and `v0.2.0` publishes `ghcr.io/cxyfer/katan:v0.2.0`. The `/healthz` version keeps the bare number.

### 5. Publish the GitHub Release

Generate the skeleton, then write the callout and the highlights:

```bash
./scripts/release-notes.sh v0.2.0      # What's Changed, New Contributors, Full Changelog
$EDITOR .tmp/release-notes-v0.2.0.md   # the callout and the ## Highlights list
./scripts/release-notes-lint.sh .tmp/release-notes-v0.2.0.md

gh release create v0.2.0 --title "v0.2.0" \
  --notes-file .tmp/release-notes-v0.2.0.md --verify-tag
```

The release title is the tag verbatim, so `v0.2.0` is published as `v0.2.0`. Do not prefix it with
the project name: the tag already names the version, and the repository is where the project is
identified.

Add a `bash` block with the install and upgrade commands directly after the callout:
`docker compose pull && docker compose up -d` for an in-place upgrade, and `docker run` with this
release's exact tag for a direct run or a pinned Compose `image:`. Write the block for the public
package, so it carries no `docker login` line. Keep the block outside the callout — the lint reads
every blockquote line as prose, so a fence inside the callout fails as hard-wrapped text. A `-rc.N`
block pins the exact tag and drops the `docker compose pull` line, which would only reach the last
stable build.

Write each callout paragraph and each highlight bullet on one line; the lint command fails the
draft if the prose is still wrapped. Add `--prerelease` for a `-rc.N` tag. The shape is fixed by
[`.github/release-notes-template.md`](.github/release-notes-template.md): a short
`> [!IMPORTANT]` summary with the upgrade notes, a `## Highlights` list grouped by area, then
`## What's Changed`, `## New Contributors` when it applies, and `**Full Changelog**`.

## Rebuilds

There is no manual trigger. A base-image CVE fix or toolchain change needs a new patch version and
tag (rule 4: never move or reuse a published tag).
