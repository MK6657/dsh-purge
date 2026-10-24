import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { readCompositionRows } from '../lib/redteam/preset-composition.js'
import { stripSubagentToolFilter } from '../lib/redteam/subagent-config.js'

const legacy = `- id: delegation
  name: cordis:group
  group: true
  config:
    - id: tool-subagent
      name: '@deepseek-ai/dsh-tool-subagent'
      disabled: false
      config:
        provider: spawn
        maxDepth: 1
        toolFilter:
          deny:
            - subagent_fork

            # Keep processing this nested list after the blank line.
            - workflow
            - ralph
        modelSelectionSettings: true

    - id: tool-subagent-fork
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: fork
- id: custom-tool
  name: example-custom-tool
  config:
    toolFilter:
      deny: [custom-action]
`

function flatten(rows) {
  return rows.flatMap((row) => row.group ? [row, ...flatten(row.config)] : [row])
}

test('migrates an existing nested subagent config without changing other plugins', () => {
  const migrated = stripSubagentToolFilter(legacy)
  assert.equal(migrated.changed, true)
  const rows = flatten(readCompositionRows(migrated.text, '/fixture'))
  const spawn = rows.find((row) => row.id === 'tool-subagent')
  assert.deepEqual(spawn.config, { provider: 'spawn', maxDepth: 1, modelSelectionSettings: true })
  assert.equal(rows.find((row) => row.id === 'tool-subagent-fork').config.provider, 'fork')
  assert.deepEqual(rows.find((row) => row.id === 'custom-tool').config.toolFilter, { deny: ['custom-action'] })
  assert.ok(migrated.text.includes(legacy.slice(legacy.indexOf('- id: custom-tool'))))
})

test('preserves user persona literal text mentioning toolFilter', () => {
  const persona = `- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: |
      User-authored explanation:
        toolFilter:
          deny:
            - example
      - id: example-in-a-prompt
        name: '@deepseek-ai/dsh-tool-subagent'
        config:
          toolFilter:
            deny: [this-is-text]
`
  const migrated = stripSubagentToolFilter(persona + legacy)
  assert.ok(migrated.text.startsWith(persona))
})

test('preserves CRLF and performs no further edits on repeat migration', () => {
  const migrated = stripSubagentToolFilter(legacy.replace(/\n/g, '\r\n'))
  assert.equal(migrated.changed, true)
  assert.ok(!/(?<!\r)\n/.test(migrated.text))
  assert.deepEqual(stripSubagentToolFilter(migrated.text), { text: migrated.text, changed: false })
})

test('handles an inline filter and a name-first plugin row', () => {
  const text = `- name: "@deepseek-ai/dsh-tool-subagent"
  config:
    toolFilter: { deny: [workflow] }
    maxDepth: 1
    agentPreset: custom-worker
`
  const migrated = stripSubagentToolFilter(text)
  assert.equal(migrated.changed, true)
  assert.deepEqual(readCompositionRows(migrated.text, '/fixture')[0].config, {
    maxDepth: 1, agentPreset: 'custom-worker',
  })
})

test('does not remove similarly named plugin options or unrelated keys', () => {
  const text = `- id: unrelated
  name: '@deepseek-ai/dsh-tool-subagent-control'
  config:
    toolFilter: { deny: [example] }
`
  assert.deepEqual(stripSubagentToolFilter(text), { text, changed: false })
  assert.deepEqual(stripSubagentToolFilter(''), { text: '', changed: false })
})

test('handles a filter at the end of a file without a final newline', () => {
  const text = `- id: tool-subagent
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    maxDepth: 1
    toolFilter:
      deny:
        - workflow`
  const migrated = stripSubagentToolFilter(text)
  assert.equal(migrated.changed, true)
  assert.deepEqual(readCompositionRows(migrated.text, '/fixture')[0].config, { provider: 'spawn', maxDepth: 1 })
})

test('bundled preset contains no rejected subagent options and retains the depth limit', () => {
  const text = readFileSync(new URL('../presets/redteam/agent.cordis.yml', import.meta.url), 'utf8')
  const rows = flatten(readCompositionRows(text, '/fixture'))
  const subagentRows = rows.filter((row) => row.name === '@deepseek-ai/dsh-tool-subagent')
  assert.ok(subagentRows.length > 0)
  for (const row of subagentRows) {
    assert.equal(Object.hasOwn(row.config, 'toolFilter'), false)
    assert.equal(Object.hasOwn(row.config, 'persona'), false)
  }
  assert.equal(rows.find((row) => row.id === 'tool-subagent').config.maxDepth, 1)
  assert.equal(stripSubagentToolFilter(text).changed, false)
})
