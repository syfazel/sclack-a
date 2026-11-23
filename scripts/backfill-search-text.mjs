// Phase 3 one-off backfill: docs.search_text for existing docs.
//
// Reads every doc's Yjs snapshot (docs.custom_fields.yjs_state_b64),
// decodes it to plain text with decodeDocState (yjs-sync.js), and writes
// the capped text (20,000 chars, decision D2) into docs.search_text.
// Docs without a snapshot, or with empty text, are counted and skipped.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
//   node scripts/backfill-search-text.mjs [--dry-run]
//
// --dry-run reads and counts but writes nothing. Without the service-role
// key the script refuses with a clear message and writes nothing — the
// key is never hardcoded, never logged, and never printed here.
// This is NOT a live test: it only writes the search_text column that
// the Phase 3 migration adds (no RLS change, no other column touched).
import { createClient } from '@supabase/supabase-js'
import * as Y from 'yjs'
import { decodeDocState, applyDocState } from '../src/lib/yjs-sync.js'
import { SEARCH_TEXT_MAX_CHARS } from '../src/lib/extract.js'

const PAGE = 500

function textFromSnapshot(b64) {
  if (!b64) return null
  const doc = new Y.Doc()
  if (!applyDocState(doc, b64, 'backfill')) return null
  return doc.getText('content').toString()
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error(
      'backfill refus: SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY را در env بگذارید؛ بدون کلید service_role هیچ‌چیز خوانده/نوشته نمی‌شود.'
    )
    process.exit(1)
  }
  const sb = createClient(url, key, { auth: { persistSession: false } })
  const counts = {
    total: 0,
    withText: 0,
    withSearchText: 0,
    noSnapshot: 0,
    emptyText: 0,
    already: 0,
    updated: 0,
    wouldUpdate: 0,
    failed: 0
  }
  const failures = []
  let from = 0
  for (;;) {
    const { data, error } = await sb
      .from('docs')
      .select('id, custom_fields, search_text')
      .order('created_at')
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('backfill: خواندن سندها رد شد:', error.message || String(error))
      process.exit(1)
    }
    const rows = data || []
    if (rows.length === 0) break
    for (const row of rows) {
      counts.total++
      if (row.search_text) counts.withSearchText++
      const text = textFromSnapshot(row.custom_fields?.yjs_state_b64)
      if (text === null) {
        counts.noSnapshot++
        continue
      }
      if (!text.trim()) {
        counts.emptyText++
        continue
      }
      counts.withText++
      const capped = text.slice(0, SEARCH_TEXT_MAX_CHARS)
      if (row.search_text === capped) {
        counts.already++
        continue
      }
      if (dryRun) {
        counts.wouldUpdate++
        continue
      }
      const { error: uerr } = await sb
        .from('docs')
        .update({ search_text: capped })
        .eq('id', row.id)
      if (uerr) {
        counts.failed++
        failures.push(row.id + ': ' + (uerr.message || String(uerr)))
      } else {
        counts.updated++
      }
    }
    if (rows.length < PAGE) break
    from += PAGE
  }
  console.log('backfill' + (dryRun ? ' --dry-run (هیچ‌چیز نوشته نشد)' : '') + ':', JSON.stringify(counts))
  if (failures.length > 0) {
    console.error('backfill: ' + failures.length + ' به‌روزرسانی رد شد:')
    for (const f of failures.slice(0, 10)) console.error('  ' + f)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('backfill failed:', e.message || String(e))
  process.exit(1)
})
