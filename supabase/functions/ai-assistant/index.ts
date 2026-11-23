// Edge Function 'ai-assistant' — Deno entry (thin shim).
// All logic lives in handler.js (plain JS, no Deno APIs) so it can be
// probed in Node without a live key. Deploy with:
//   supabase secrets set GEMINI_API_KEY=<key from AI Studio>
//   supabase functions deploy ai-assistant
// (CLI / dashboard — NOT from this VM; there is no supabase CLI here
// and no service-role key. See README-D3.md, release 0.18.0.)
// The function needs NO service-role key: it verifies the caller's JWT
// and reads membership + the daily cap + the workspace through REST
// with the caller's own JWT (RLS allows exactly that). SUPABASE_URL and
// SUPABASE_ANON_KEY are auto-provided inside Edge Functions.
//
// The Yjs doc-text decoder is wired here (Phase 1): yjs comes from
// esm.sh (pinned to the same version as package.json) because the
// function bundle has no npm install step. It is the same decode the
// client does in work.js textFromStateB64 (Y.Doc + applyUpdate on the
// base64 snapshot, read the 'content' text). A bad snapshot decodes to
// '' (empty doc), never throws.
import { handleAssistantRequest } from './handler.js'
import * as Y from 'https://esm.sh/yjs@13.6.33'

function decodeDocText(b64) {
  if (!b64) return ''
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, bytes)
    return doc.getText('content').toString()
  } catch {
    return ''
  }
}

Deno.serve((req) =>
  handleAssistantRequest(req, { env: Deno.env, fetchFn: fetch, decodeDocText })
)
