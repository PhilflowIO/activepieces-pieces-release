#!/usr/bin/env node
// Turns the publish manifest upstream's tooling wrote into dist/package.json
// into the one we publish under our scope, and refuses anything that would
// publish something other than a self-contained piece.
//
// Runs in the checkout of the fork, after upstream's own preparation step
// (tools/scripts/pieces/prepare-pieces-for-publish.ts), which bundles the piece
// and strips the @activepieces/* workspace dependencies it inlined. The source
// package.json keeps its upstream name, so the piece can go upstream unchanged;
// only this packed manifest carries @philflow/piece-<slug>.
//
// `repository` names THIS release repository: npm's provenance check rejects a
// publish (E422) whose repository.url differs from the repository that built it.
// Where the code comes from is recorded in `raven.source` (fork, commit,
// directory, license file), which Raven's piece vetting reads.
//
// Usage: prepare-piece-release.mjs <piece dir> <version> <fork commit> <release repo, owner/name>
// Prints one JSON line: {"name","version","slug","dist","sourceCommit"}.
//
// The defaults are the public release (GitHub, @philflow). An internal build
// for a staging test before anything is public (Philflow/flow.raven#10021)
// sets PIECE_SCOPE=@philflow-internal, GIT_HOST=https://forgejo.philflow.me
// and FORK=Philflow/activepieces, so the manifest names where that build
// really comes from: the private Forgejo mirrors of the fork and of this repo.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const FORK = process.env.FORK || 'PhilflowIO/activepieces'
const SCOPE = process.env.PIECE_SCOPE || '@philflow'
const GIT_HOST = process.env.GIT_HOST || 'https://github.com'

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

const [pieceDirArg, expectedVersion, forkCommit, releaseRepo] = process.argv.slice(2)
if (!pieceDirArg || !expectedVersion || !forkCommit || !releaseRepo) {
  fail('usage: prepare-piece-release.mjs <piece dir> <version> <fork commit> <release repo>')
}
if (!/^[0-9a-f]{40}$/.test(forkCommit)) fail(`fork commit ${forkCommit} is not a full 40-character SHA`)
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(releaseRepo)) fail(`release repository ${releaseRepo} is not owner/name`)
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(FORK)) fail(`fork ${FORK} is not owner/name`)
if (!/^@[a-z0-9][a-z0-9-]*$/.test(SCOPE)) fail(`scope ${SCOPE} is not an npm scope`)
if (!['https://github.com', 'https://forgejo.philflow.me'].includes(GIT_HOST)) fail(`git host ${GIT_HOST} is not one Raven's piece vetting admits`)

const pieceDir = resolve(pieceDirArg)
const slug = basename(pieceDir)
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail(`piece directory name "${slug}" is not a valid slug`)
const pieceDirInRepo = `packages/pieces/community/${slug}`

const source = JSON.parse(readFileSync(join(pieceDir, 'package.json'), 'utf8'))
const distDir = join(pieceDir, 'dist')
const manifestPath = join(distDir, 'package.json')
if (!existsSync(manifestPath)) fail(`${manifestPath} is missing; run the build and upstream's prepare step first`)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

// The source name stays upstream's, so a later upstream PR is the same code.
const upstreamName = `@activepieces/piece-${slug}`
if (source.name !== upstreamName) fail(`source package.json is named ${source.name}, expected ${upstreamName}`)
if (manifest.name !== upstreamName) fail(`dist manifest is named ${manifest.name}, expected ${upstreamName}`)

// npm drops +build metadata and would publish a shorter, different version.
const version = manifest.version
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) fail(`version ${version} is not plain semver (build metadata is refused)`)
if (version !== source.version) fail(`dist version ${version} differs from source version ${source.version}`)
if (expectedVersion !== version) fail(`release asks for ${expectedVersion}, the piece is at ${version}`)

// Same gate as upstream's publish step (tools/scripts/utils/publish-npm-package.ts):
// a published piece is a bundle; no workspace range and no @activepieces/*
// package may be left, and every remaining dependency is an exact version.
const offending = []
for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
    if (String(range).startsWith('workspace:')) offending.push(`${field}.${dep}: ${range} (unresolved workspace dependency)`)
    else if (dep.startsWith('@activepieces/')) offending.push(`${field}.${dep}: ${range} (must be bundled)`)
    else if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(String(range))) offending.push(`${field}.${dep}: ${range} (not an exact version)`)
  }
}
if (offending.length > 0) fail(`unpublishable dependencies:\n  ${offending.join('\n  ')}`)

// Nothing may run on install or around npm pack.
const scripts = Object.keys(manifest.scripts ?? {})
if (scripts.length > 0) fail(`dist manifest still defines scripts: ${scripts.join(', ')}`)

if (!manifest.main || !existsSync(join(distDir, manifest.main))) fail(`entry point ${manifest.main} is missing from ${distDir}`)

// The fork's LICENSE (MIT outside packages/ee) travels inside the package, so
// the tarball carries the terms it is published under.
const forkRoot = resolve(pieceDir, '../../../..')
const licenseSource = join(forkRoot, 'LICENSE')
if (!existsSync(licenseSource)) fail(`no LICENSE at the fork root ${forkRoot}`)
if (!/MIT Expat/.test(readFileSync(licenseSource, 'utf8'))) fail('the fork LICENSE no longer names the MIT Expat terms; check the license before publishing')
copyFileSync(licenseSource, join(distDir, 'LICENSE'))

const name = `${SCOPE}/piece-${slug}`
manifest.name = name
manifest.license = 'MIT'
manifest.repository = { type: 'git', url: `git+${GIT_HOST}/${releaseRepo}.git` }
manifest.homepage = GIT_HOST === 'https://github.com'
  ? `${GIT_HOST}/${FORK}/tree/${forkCommit}/${pieceDirInRepo}`
  : `${GIT_HOST}/${FORK}/src/commit/${forkCommit}/${pieceDirInRepo}`
manifest.raven = {
  source: {
    repository: `${GIT_HOST}/${FORK}`,
    commit: forkCommit,
    directory: pieceDirInRepo,
    upstreamName,
    license: 'LICENSE',
  },
}
manifest.files = [...new Set([...(manifest.files ?? []), 'LICENSE'])]
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

console.log(JSON.stringify({ name, version, slug, dist: distDir, sourceCommit: forkCommit }))
