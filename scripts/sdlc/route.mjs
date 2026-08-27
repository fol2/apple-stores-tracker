import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ZERO_SHA = /^0+$/

const ROOT_MARKDOWN = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  '.github/pull_request_template.md',
])

export function isGovernanceMarkdown(path) {
  if (!path.endsWith('.md')) return false
  return (
    ROOT_MARKDOWN.has(path) ||
    path.startsWith('docs/') ||
    path.startsWith('.claude/agents/') ||
    path.startsWith('.claude/skills/') ||
    path.startsWith('.github/ISSUE_TEMPLATE/')
  )
}

export function classifyPaths(paths) {
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) {
    return { scope: 'full', reason: 'empty-or-unresolved-diff' }
  }

  if (unique.every(isGovernanceMarkdown)) {
    return { scope: 'governance', reason: 'governance-markdown-only' }
  }

  return { scope: 'full', reason: 'runtime-or-authority-change' }
}

export function changedPaths(base, head, cwd = process.cwd()) {
  if (!base || !head || ZERO_SHA.test(base) || ZERO_SHA.test(head)) {
    throw new Error('missing comparison commit')
  }

  for (const ref of [base, head]) {
    execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], {
      cwd,
      stdio: 'ignore',
    })
  }

  const output = execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--no-renames', `${base}...${head}`],
    { cwd, encoding: 'utf8' },
  )
  return output.split('\0').filter(Boolean)
}

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function main() {
  const base = argument('--base')
  const head = argument('--head')

  let result
  try {
    result = classifyPaths(changedPaths(base, head))
  } catch {
    result = { scope: 'full', reason: 'comparison-unavailable' }
  }

  // GitHub output format. Values are deliberately single-line and do not
  // include filenames, so unusual valid paths cannot corrupt the output file.
  console.log(`scope=${result.scope}`)
  console.log(`reason=${result.reason}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
