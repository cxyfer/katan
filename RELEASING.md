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

A push to `master` runs the same build and smoke test, and publishes `master` and `latest`. A
documentation-only change is ignored by `paths-ignore`.

## Image tags

| Git ref | Tags pushed | Notes |
|---------|-------------|-------|
| `master` | `master`, `latest`, `sha-<short>` | `latest` follows `master` |
| `v0.2.0` (stable) | `0.2.0`, `0.2`, `latest`, `sha-<short>` | Moving tags follow the tag |
| `v0.3.0-rc.1` | `0.3.0-rc.1`, `sha-<short>` | Pre-release: never moves `0.3` or `latest` |
| Pull request | `sha-<short>` | Build and smoke test only; the digest is what a merge publishes |

The image tag mirrors the version without the `v` prefix; `latest` is the only tag that is not a
version. `sha-<short>` is per commit and exists for rollback: pin the digest when you need an exact
build.

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
5. **Only stable tags move `X.Y` and `latest`.** A pre-release keeps its exact tag so it cannot
   hijack what players pull.
6. **Publishing happens on `master`, not only on tags.** A tag and a `master` push of the same commit
   are two builds: the digests differ because the attestations carry different timestamps. If the
   order matters, wait for the `master` run to finish before tagging.
7. **The GitHub Release is manual, in the standard format.** Publish it after the image exists, with
   notes scaffolded by [`scripts/release-notes.sh`](scripts/release-notes.sh) and shaped by
   [`.github/release-notes-template.md`](.github/release-notes-template.md). Keep every prose
   paragraph and highlight bullet on one source line — GitHub turns a newline inside a release body
   into a hard break — and run [`scripts/release-notes-lint.sh`](scripts/release-notes-lint.sh) on
   the draft.
8. **GHCR visibility is a repository setting.** A private repository produces a private package.
   Authenticate with `docker login ghcr.io` (token scope `read:packages`) or make the package
   public.
9. **Pull request builds also push into the package.** They are test artefacts under `sha-<short>` and
   may be pruned; they are never referenced by a release tag.

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
a tag whose `package.json` disagrees. Waiting for the `master` run to finish here keeps the tag build
the one that ends up on `latest`.

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

docker login ghcr.io      # only if the package is private
docker buildx imagetools inspect ghcr.io/cxyfer/katan:0.2.0
```

`imagetools inspect` must list both `linux/amd64` and `linux/arm64`. The workflow already asserts
that `/healthz` reports the version of the commit it built, so this manual check is a second opinion
on the same claim — the tag, the bundle and the image must agree:

```bash
docker run --rm -d --name catan-version-check -p 3411:3000 \
  ghcr.io/cxyfer/katan:0.2.0
curl -s http://127.0.0.1:3411/healthz      # {"ok":true,"data":{"version":"0.2.0",...}}
docker rm -f catan-version-check
```

### 5. Publish the GitHub Release

Generate the skeleton, then write the callout and the highlights:

```bash
./scripts/release-notes.sh v0.2.0      # What's Changed, New Contributors, Full Changelog
$EDITOR .tmp/release-notes-v0.2.0.md   # the callout and the ## Highlights list
./scripts/release-notes-lint.sh .tmp/release-notes-v0.2.0.md

gh release create v0.2.0 --title "catan 0.2.0" \
  --notes-file .tmp/release-notes-v0.2.0.md --verify-tag
```

Write each callout paragraph and each highlight bullet on one line; the lint command fails the
draft if the prose is still wrapped. Add `--prerelease` for a `-rc.N` tag. The shape is fixed by
[`.github/release-notes-template.md`](.github/release-notes-template.md): a short
`> [!IMPORTANT]` summary with the upgrade notes, a `## Highlights` list grouped by area, then
`## What's Changed`, `## New Contributors` when it applies, and `**Full Changelog**`.

## Manual rebuilds

*Actions → Docker image → Run workflow*, choosing the branch to rebuild.

- Running it on `master` republishes `master` and `latest` from the current `master`.
- Running it on another branch publishes that branch's name as a tag and nothing moving.

Typical uses: a base-image CVE fix or a runner/toolchain change without a new application version.
Rebuilding does not create a release; the notes stay manual.
