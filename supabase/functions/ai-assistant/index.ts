// Edge Function 'ai-assistant' — Deno entry (thin shim).
// All logic lives in handler.js (plain JS, no Deno APIs) so it can be
// probed in Node without a live key. Deploy with:
//   supabase secrets set GEMINI_API_KEY=<key from AI Studio>
//   supabase functions deploy ai-assistant
// (CLI / dashboard — NOT from this VM; there is no supabase CLI here
// and no service-role key. See README-D3.md, release 0.18.0.)
// The function needs NO service-role key: it verifies the caller's JWT
// and reads membership + the daily cap through REST with the caller's
// own JWT (RLS allows exactly that). SUPABASE_URL and
// SUPABASE_ANON_KEY are auto-provided inside Edge Functions.
import { handleAssistantRequest } from './handler.js'

Deno.serve((req) => handleAssistantRequest(req, { env: Deno.env, fetchFn: fetch }))
