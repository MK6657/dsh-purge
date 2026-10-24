/**
 * DSH 0.2.1 rejects toolFilter in dsh-tool-subagent configurations.
 * Remove only that deprecated key, preserving the user's other YAML verbatim.
 * maxDepth remains the supported recursion limit; this does not translate a
 * custom deny list into an independent child Agent Preset.
 */
export function stripSubagentToolFilter(text) {
  const original = String(text || '')
  const newline = original.includes('\r\n') ? '\r\n' : '\n'
  const lines = original.split(/\r?\n/)
  const removed = new Set()
  const indentOf = (line) => (/^[ \t]*/.exec(line) || [''])[0].length
  const rowStart = (line) => /^([ \t]*)-\s+(?:id|name):/.exec(line)
  // A persona may contain example YAML. Its literal/folded scalar is data,
  // including lines that happen to look like plugin declarations.
  const scalarLines = new Set()
  let scalarIndent = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (scalarIndent !== null) {
      if (!line.trim() || indentOf(line) > scalarIndent) {
        scalarLines.add(index)
        continue
      }
      scalarIndent = null
    }
    if (!line.trimStart().startsWith('#') && /:\s*[|>][1-9+-]*\s*(?:#.*)?$/.test(line)) {
      scalarIndent = indentOf(line)
    }
  }

  for (let start = 0; start < lines.length; start += 1) {
    if (scalarLines.has(start)) continue
    const row = rowStart(lines[start])
    if (!row) continue
    const indent = row[1].length
    let end = start + 1
    while (end < lines.length) {
      const line = lines[end]
      if (!scalarLines.has(end) && line.trim() && !line.trimStart().startsWith('#')
        && (rowStart(line) || indentOf(line) <= indent)) break
      end += 1
    }
    const namesSubagent = lines.slice(start, end).some((line, offset) => {
      if (scalarLines.has(start + offset)) return false
      const name = offset === 0
        ? /^\s*- name:\s*(.*?)\s*$/.exec(line)
        : indentOf(line) === indent + 2 && /^\s*name:\s*(.*?)\s*$/.exec(line)
      return name && /^(['"]?)@deepseek-ai\/dsh-tool-subagent\1(?:\s+#.*)?$/.test(name[1])
    })
    if (!namesSubagent) continue
    const config = lines.findIndex((line, index) => index > start && index < end
      && indentOf(line) === indent + 2 && /^\s*config:\s*(?:#.*)?$/.test(line))
    if (config < 0) continue
    for (let index = config + 1; index < end; index += 1) {
      const line = lines[index]
      if (line.trim() && !line.trimStart().startsWith('#') && indentOf(line) <= indent + 2) break
      if (indentOf(line) !== indent + 4 || !/^\s*toolFilter:/.test(line)) continue
      removed.add(index)
      // Blank/comment lines must not prematurely end a nested YAML value.
      while (index + 1 < end) {
        const next = lines[index + 1]
        if (next.trim() && indentOf(next) <= indent + 4) break
        index += 1
        removed.add(index)
      }
    }
  }
  if (!removed.size) return { text: original, changed: false }
  return { text: lines.filter((_, index) => !removed.has(index)).join(newline), changed: true }
}
