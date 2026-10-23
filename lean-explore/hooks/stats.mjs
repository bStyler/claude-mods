// Lean Explore ledger: what Explore runs actually did, kept per model.
// Shape (JSON, lives in $.store): { v, scanned, byModel: { <model id>: Row } }
// Row: runs, input (uncached), cacheRead, cacheWrite, output, readChars (tool results the
// agent read), reportChars (what it handed back), tools { name: count }.

export const KEY = 'lean-explore.ledger'
const CHARS_PER_TOKEN = 4

export const emptyRow = () => ({ runs: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, readChars: 0, reportChars: 0, tools: {} })
export const emptyLedger = () => ({ v: 1, scanned: false, byModel: {} })

export function addRow(ledger, model, row) {
  const into = (ledger.byModel[model] ??= emptyRow())
  for (const k of ['runs', 'input', 'cacheRead', 'cacheWrite', 'output', 'readChars', 'reportChars']) into[k] += Number(row[k]) || 0
  for (const [t, n] of Object.entries(row.tools ?? {})) into.tools[t] = (into.tools[t] ?? 0) + n
  return ledger
}

// A finished live run, as collected by the hooks.
export function addRun(ledger, run) {
  return addRow(ledger, run.model || 'unknown', {
    runs: 1, input: run.input, cacheRead: run.cacheRead, cacheWrite: run.cacheWrite, output: run.output,
    readChars: run.readChars, reportChars: run.reportChars, tools: run.tools,
  })
}

// Replace the ledger's contents with the totals a transcript scan found.
export function fromScan(scan) {
  const ledger = emptyLedger()
  ledger.scanned = true
  for (const [model, row] of Object.entries(scan.byModel ?? {})) addRow(ledger, model, row)
  return ledger
}

export const isHaiku = m => /haiku/i.test(m)
export const total = r => r.input + r.cacheRead + r.cacheWrite + r.output
const sum = (rows, f) => rows.reduce((n, r) => n + f(r), 0)

export function summarize(ledger) {
  const rows = Object.entries(ledger.byModel)
  const lean = rows.filter(([m]) => isHaiku(m)).map(([, r]) => r)
  const other = rows.filter(([m]) => !isHaiku(m)).map(([, r]) => r)
  const reads = r => (r.tools.Read ?? 0) + (r.tools.Grep ?? 0) + (r.tools.Glob ?? 0)
  const kept = r => Math.max(0, r.readChars - r.reportChars) / CHARS_PER_TOKEN
  const runs = sum(lean, r => r.runs)
  return {
    runs,
    otherRuns: sum(other, r => r.runs),
    delegated: sum(lean, total), // every token Haiku processed instead of the main model
    fresh: sum(lean, r => r.input + r.cacheWrite + r.output), // the part billed at full price
    cached: sum(lean, r => r.cacheRead),
    reads: sum(lean, reads),
    keptOutOfChat: Math.round(sum(lean, kept)), // file text read that never reached the main chat
    reportTokens: Math.round(sum(lean, r => r.reportChars) / CHARS_PER_TOKEN),
    avgPerRun: runs ? Math.round(sum(lean, total) / runs) : 0,
    models: rows.map(([model, r]) => ({ model, runs: r.runs, tokens: total(r) })).sort((a, b) => b.runs - a.runs),
  }
}
