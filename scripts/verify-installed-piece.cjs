#!/usr/bin/env node
// Loads a piece the way a consumer gets it: installed from the packed tarball
// into an empty project, resolved only against the public registry. Fails
// unless the package exports a piece with at least one action or trigger.
//
// Usage (from the consumer directory): verify-installed-piece.cjs <name> <version> <fork commit>
'use strict'
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const [name, version, forkCommit] = process.argv.slice(2)
if (!name || !version || !forkCommit) {
  console.error('usage: verify-installed-piece.cjs <name> <version> <fork commit>')
  process.exit(1)
}

const installedManifest = JSON.parse(readFileSync(join(process.cwd(), 'node_modules', name, 'package.json'), 'utf8'))
if (installedManifest.version !== version) {
  console.error(`installed ${name}@${installedManifest.version}, expected ${version}`)
  process.exit(1)
}
// Raven's vetting maps package -> fork commit -> license from these.
const sourceCommit = installedManifest.raven && installedManifest.raven.source && installedManifest.raven.source.commit
if (sourceCommit !== forkCommit) {
  console.error(`raven.source.commit is ${sourceCommit}, expected ${forkCommit}`)
  process.exit(1)
}
if (!existsSync(join(process.cwd(), 'node_modules', name, 'LICENSE'))) {
  console.error('the installed package carries no LICENSE')
  process.exit(1)
}

const exported = require(require.resolve(name, { paths: [process.cwd()] }))
const pieces = Object.entries(exported).filter(([, value]) =>
  value && typeof value.displayName === 'string' && typeof value.metadata === 'function')
if (pieces.length !== 1) {
  console.error(`expected exactly one exported piece, found ${pieces.length} (exports: ${Object.keys(exported).join(', ')})`)
  process.exit(1)
}

const [exportName, piece] = pieces[0]
const metadata = piece.metadata()
const actions = Object.keys(metadata.actions ?? {})
const triggers = Object.keys(metadata.triggers ?? {})
console.log(JSON.stringify({ name, version, sourceCommit, export: exportName, displayName: metadata.displayName, actions, triggers }))
if (actions.length + triggers.length === 0) {
  console.error('the piece has no actions and no triggers')
  process.exit(1)
}
