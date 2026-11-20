# activepieces-pieces-release

Publishes Activepieces pieces maintained in [PhilflowIO/activepieces](https://github.com/PhilflowIO/activepieces) (branch `raven`) to npm as `@philflow/piece-<slug>`.

This repository holds only the release workflow. GitHub Actions stay disabled on the fork, because it carries upstream's workflows.

## Releasing a piece

1. Bump the piece's `version` in the fork and merge it into `raven`.
2. Here, set `pieces/<slug>.json` to that version and the full `raven` commit SHA, and merge it into `main`.
3. Tag that commit `piece-<slug>@<version>` and push the tag.

The workflow builds the piece at the pinned commit with upstream's tooling, runs its tests, and installs and loads the packed tarball in an empty project. It then publishes the tarball through npm trusted publishing with provenance. A required reviewer approves the `npm-publish` environment before anything is published.

The published `package.json` names this repository in `repository`, because npm's provenance check requires it. It records the source under `raven.source`: fork, commit, directory and license file.
