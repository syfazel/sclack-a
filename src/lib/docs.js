import { sb } from './supabase.js'
import { auth, ws } from './store.svelte.js'
import * as Y from 'yjs'
import { encodeDocState, applyDocState } from './yjs-sync.js'

// Docs, comments and files (D4). Reads/writes only what RLS allows the
// signed-in member to see. No test data is ever written here.

// ---------- docs ----------

export async function loadDocs(projectId) {
  if (!sb || !projectId) {
    ws.docs = []
    return
  }
  const { data, error } = await sb
    .from('docs')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at')
  // Stale response (project switched while loading): discard (D6 bug 5).
  if (ws.currentProjectId !== projectId) return
  if (!error) ws.docs = data || []
  else ws.error = error.message
}

function newYjsDocId(projectId) {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'doc-' + Date.now() + '-' + Math.floor(Math.random() * 1e9)
  return 'doc-' + projectId + '-' + rand
}

export async function createDoc(projectId, title) {
  const clean = (title || '').trim()
  if (!clean) throw new Error('نام سند را بنویسید.')
  if (!auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  const { data, error } = await sb
    .from('docs')
    .insert({
      project_id: projectId,
      title: clean,
      yjs_doc_id: newYjsDocId(projectId),
      created_by: auth.member.id,
      visibility: 'project'
    })
    .select()
    .single()
  if (error) throw error
  await loadDocs(projectId)
  return data
}

// The auto doc created with every new project (alongside the auto room).
export async function createAutoDoc(projectId) {
  const { data, error } = await sb
    .from('docs')
    .insert({
      project_id: projectId,
      title: 'سند',
      yjs_doc_id: newYjsDocId(projectId),
      created_by: auth.member.id,
      visibility: 'project'
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function loadDocRow(docId) {
  const { data, error } = await sb.from('docs').select('*').eq('id', docId).single()
  if (error) throw error
  return data
}

// ---------- row-based sync ----------
// Snapshot in docs.custom_fields.yjs_state_b64. Save = load the row, merge
// any newer remote state into the local doc, then write the merged snapshot.
// The versions table is deliberately NOT used as an update log: versions
// rows are immutable (no delete policy), so a per-save log would grow
// forever. D5 owns versions (restore points).

export async function loadRowStateInto(docRow, ydoc) {
  const cf = docRow.custom_fields || {}
  if (cf.yjs_state_b64) return applyDocState(ydoc, cf.yjs_state_b64, 'row')
  return false
}

export async function saveDocRow(docRow, ydoc, lastSavedB64) {
  const { data, error } = await sb
    .from('docs')
    .select('custom_fields')
    .eq('id', docRow.id)
    .single()
  if (error) throw error
  const remote = data?.custom_fields?.yjs_state_b64
  if (remote && remote !== lastSavedB64) {
    applyDocState(ydoc, remote, 'row')
  }
  const b64 = encodeDocState(ydoc)
  if (b64 === remote) return b64 // nothing new to write
  const cf = { ...(data?.custom_fields || {}), yjs_state_b64: b64 }
  const { error: uerr } = await sb
    .from('docs')
    .update({ custom_fields: cf, updated_at: new Date().toISOString() })
    .eq('id', docRow.id)
  if (uerr) throw uerr
  return b64
}

// ---------- comments ----------
// Anchor: Yjs RelativePositions (survive concurrent edits) + the quoted
// text, so a comment can always show what it was about even if the range
// can no longer be resolved.

export function makeAnchor(ytext, ydoc, start, end) {
  const text = ytext.toString()
  const s = Math.max(0, Math.min(start, text.length))
  const e = Math.max(s, Math.min(end, text.length))
  const relStart = Y.createRelativePositionFromTypeIndex(ytext, s)
  const relEnd = Y.createRelativePositionFromTypeIndex(ytext, e)
  return {
    start: relStart ? relStart.toJSON() : null,
    end: relEnd ? relEnd.toJSON() : null,
    quote: text.slice(s, e).slice(0, 120)
  }
}

export function resolveAnchor(ydoc, anchor) {
  if (!anchor || !anchor.start || !anchor.end) return null
  try {
    const absStart = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(anchor.start),
      ydoc
    )
    const absEnd = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(anchor.end),
      ydoc
    )
    if (!absStart || !absEnd) return null
    return { start: absStart.index, end: absEnd.index }
  } catch {
    return null
  }
}

export async function loadComments(docId) {
  if (!sb || !docId) return []
  const { data, error } = await sb
    .from('comments')
    .select('*')
    .eq('doc_id', docId)
    .order('created_at')
  if (error) throw error
  return data || []
}

export async function addComment(docId, body, anchor) {
  const clean = (body || '').trim()
  if (!clean) throw new Error('متن نظر را بنویسید.')
  if (!auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  const { data, error } = await sb
    .from('comments')
    .insert({
      doc_id: docId,
      author_id: auth.member.id,
      body: clean,
      anchor: anchor || null,
      resolved: false,
      visibility: 'project'
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function setCommentResolved(commentId, resolved) {
  const { error } = await sb
    .from('comments')
    .update({ resolved })
    .eq('id', commentId)
  if (error) throw error
}

// ---------- files (Supabase Storage) ----------

export const FILES_BUCKET = 'sclack-files'
export const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB — same cap as the Space app

export function isBucketMissingError(err) {
  const m = (err && err.message) || ''
  return /bucket not found/i.test(m) || /not found/i.test(m)
}

export function fileErrorMessage(err) {
  if (isBucketMissingError(err)) {
    return (
      'باکت فایل هنوز ساخته نشده است — فایل‌ها پس از ساخت باکت در داشبورد ' +
      'و اجرای سیاست‌های D4 کار می‌کنند.'
    )
  }
  return 'فایل فرستاده نشد: ' + ((err && err.message) || String(err))
}

export async function listFiles(projectId) {
  if (!sb || !projectId) {
    ws.files = []
    return
  }
  const { data, error } = await sb
    .from('files')
    .select('*')
    .eq('project_id', projectId)
    .order('uploaded_at', { ascending: false })
  // Stale response (project switched while loading): discard (D6 bug 5).
  // FileList components always pass their own project's id, and the
  // project sync in DocView / the route effect keeps currentProjectId
  // aligned with the displayed project before they mount.
  if (ws.currentProjectId !== projectId) return
  if (!error) ws.files = data || []
  else ws.error = error.message
}

function sanitizeFileName(name) {
  const base = (name || 'file').split(/[\\/]/).pop() || 'file'
  return base.replace(/[\u0000-\u001f]/g, '').slice(0, 120) || 'file'
}

export async function uploadFile(projectId, file, attachedTo) {
  if (!file) throw new Error('فایلی انتخاب نشده است.')
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      'فایل بزرگ‌تر از ۵ مگابایت است (' +
        (file.size / 1024 / 1024).toFixed(1) +
        ' مگابایت)؛ فایل کوچک‌تر انتخاب کنید.'
    )
  }
  if (!auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'f-' + Date.now() + '-' + Math.floor(Math.random() * 1e9)
  const path = projectId + '/' + rand + '-' + sanitizeFileName(file.name)
  const { error: upErr } = await sb.storage.from(FILES_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined
  })
  if (upErr) throw new Error(fileErrorMessage(upErr))
  const { data, error } = await sb
    .from('files')
    .insert({
      project_id: projectId,
      name: file.name,
      size: file.size,
      mime: file.type || null,
      storage: 'supabase',
      storage_path: path,
      uploaded_by: auth.member.id,
      attached_to_type: attachedTo ? attachedTo.type : null,
      attached_to_id: attachedTo ? attachedTo.id : null,
      visibility: 'project'
    })
    .select()
    .single()
  if (error) {
    // Row insert failed after the bytes landed: remove the orphan object.
    await sb.storage.from(FILES_BUCKET).remove([path])
    throw error
  }
  await listFiles(projectId)
  return data
}

export async function downloadFile(fileRow) {
  if (!fileRow?.storage_path) throw new Error('مسیر فایل در ردیف نیست.')
  const { data, error } = await sb.storage
    .from(FILES_BUCKET)
    .createSignedUrl(fileRow.storage_path, 3600)
  if (error) throw new Error(fileErrorMessage(error))
  return data.signedUrl
}

export async function deleteFile(fileRow) {
  if (!fileRow?.id) throw new Error('ردیف فایل مشخص نیست.')
  // PostgREST DELETE without .select() answers success even when RLS
  // blocks the delete (0 rows affected) — that silent no-op was D6 bug 3.
  // Select the deleted row back and treat "0 rows" as a failure.
  const { data, error } = await sb
    .from('files')
    .delete()
    .eq('id', fileRow.id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('فایل حذف نشد — فقط فرستندهٔ فایل می‌تواند آن را حذف کند.')
  }
  // Only remove the storage object once the row is really gone.
  if (fileRow.storage_path) {
    const { error: rerr } = await sb.storage
      .from(FILES_BUCKET)
      .remove([fileRow.storage_path])
    if (rerr) {
      throw new Error(
        'ردیف فایل حذف شد ولی حذف فایل از انباره ناموفق بود: ' + (rerr.message || String(rerr))
      )
    }
  }
  await listFiles(fileRow.project_id)
}

export function formatFileSize(size) {
  if (size === null || size === undefined) return ''
  if (size < 1024) return size + ' بایت'
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' کیلوبایت'
  return (size / 1024 / 1024).toFixed(1) + ' مگابایت'
}
