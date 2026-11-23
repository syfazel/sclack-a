import { sb } from './supabase.js'
import { auth, ws } from './store.svelte.js'
import * as Y from 'yjs'
import { encodeDocState, applyDocState } from './yjs-sync.js'
import { SEARCH_TEXT_MAX_CHARS, validateDocParent } from './extract.js'
import { FORM_ROOYESH_46, FORM_KIND, emptyFormAnswers } from './form-rooyesh.js'
import { RULES_55, RULES_KIND } from './rules-aim.js'

// نگهبان ستون search_text (فاز ۳): مهاجرت زنده هنوز اجرا نشده و کدِ
// دیپلوی‌شده پیش از آن زنده می‌شود؛ تا وقتی ستون نیست، نوشتن/خواندنش
// هرگز نباید ذخیرهٔ سند یا جست‌وجو را بشکند. فقط خطای «ستون وجود ندارد»
// (کد 42703 یا پیام undefined column) بی‌صدا رد می‌شود؛ هر خطای دیگری
// مثل قبل پرتاب می‌شود.
export function isMissingColumnError(err) {
  if (!err) return false
  if (err.code === '42703') return true
  const m = err.message || String(err)
  return /undefined column/i.test(m) || /column .* does not exist/i.test(m)
}

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

// ---------- یادداشت خصوصی (بخش خصوصی سایدبار، D-UX5 الف) ----------
// visibility='personal': سیاست RLS ‏w1 docs select فقط سازنده را
// می‌بیند (visibility در team/project نیست و created_by = من) — پس
// یادداشت خصوصی در سطح دیتابیس هم فقط مال من است، نه فقط در UI.
// یادداشت خصوصی project_id هم دارد (پروژهٔ جاری در زمان ساخت) ولی
// در درخت سندهای پروژه نشان داده نمی‌شود؛ فقط در بخش خصوصی می‌آید.
export async function createPrivateDoc(projectId, title) {
  const clean = (title || '').trim()
  if (!clean) throw new Error('نام یادداشت را بنویسید.')
  if (!auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  const { data, error } = await sb
    .from('docs')
    .insert({
      project_id: projectId || null,
      title: clean,
      yjs_doc_id: newYjsDocId(projectId || 'private'),
      created_by: auth.member.id,
      visibility: 'personal'
    })
    .select()
    .single()
  if (error) throw error
  await loadPrivateDocs()
  return data
}

// یادداشت‌های خصوصیِ من، در همهٔ پروژه‌ها (نه فقط پروژهٔ جاری).
export async function loadPrivateDocs() {
  if (!sb || !auth.member) {
    ws.privateDocs = []
    return
  }
  const { data, error } = await sb
    .from('docs')
    .select('*')
    .eq('created_by', auth.member.id)
    .eq('visibility', 'personal')
    .order('created_at')
  if (!error) ws.privateDocs = data || []
  else ws.error = error.message
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

// ---------- سندهای ساخت‌یافته (فاز ۶ فرم ۴۶ سوالی، فاز ۱۰ مخزن ۵۵ قانون) ----------
// تعریف کامل و پاسخ‌ها در custom_fields خود سند نگه داشته می‌شوند —
// بدون جدول تازه. سند فرم/قوانین متن Yjs ندارد و در DocView نمای
// ویژه (FormView / RulesView) می‌گیرد، نه ویرایشگر متن.

// ادغام patch در custom_fields سند (خواندن تازه، بعد نوشتن) و برگرداندن
// مقدار ادغام‌شده. برای ذخیرهٔ پاسخ‌های فرم به کار می‌رود.
export async function setDocCustomFields(docRow, patch) {
  if (!docRow?.id) throw new Error('سند مشخص نیست.')
  const { data, error } = await sb
    .from('docs')
    .select('custom_fields')
    .eq('id', docRow.id)
    .single()
  if (error) throw error
  const merged = { ...(data?.custom_fields || {}), ...patch }
  const { error: uerr } = await sb
    .from('docs')
    .update({ custom_fields: merged, updated_at: new Date().toISOString() })
    .eq('id', docRow.id)
  if (uerr) throw uerr
  return merged
}

export function findFormDoc(docs) {
  return (docs || []).find((d) => d.custom_fields?.form_kind === FORM_KIND) || null
}

export function findRulesDoc(docs) {
  return (docs || []).find((d) => d.custom_fields?.rules_kind === RULES_KIND) || null
}

export async function createFormDoc(projectId) {
  if (!auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  const existing = findFormDoc(ws.docs)
  if (existing) return existing
  const { data, error } = await sb
    .from('docs')
    .insert({
      project_id: projectId,
      title: 'د — کاربرگ رسمی رویش (۴۶ سؤال)',
      yjs_doc_id: newYjsDocId(projectId),
      created_by: auth.member.id,
      visibility: 'project',
      custom_fields: {
        form_kind: FORM_KIND,
        form_def: FORM_ROOYESH_46,
        form_answers: emptyFormAnswers()
      }
    })
    .select()
    .single()
  if (error) throw error
  await loadDocs(projectId)
  return data
}

export async function createRulesDoc(projectId) {
  if (!auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  const existing = findRulesDoc(ws.docs)
  if (existing) return existing
  const { data, error } = await sb
    .from('docs')
    .insert({
      project_id: projectId,
      title: 'ز — مخزن قوانین اجرای AIM (۵۵ قانون)',
      yjs_doc_id: newYjsDocId(projectId),
      created_by: auth.member.id,
      visibility: 'project',
      custom_fields: {
        rules_kind: RULES_KIND,
        rules: RULES_55
      }
    })
    .select()
    .single()
  if (error) throw error
  await loadDocs(projectId)
  return data
}

// ---------- Phase 5: nested docs (decision D4) ----------
// Move a doc under a new parent (null = back to the root). The cycle
// guard runs first, against ws.docs: the parent can never be the doc
// itself or one of its descendants. When the live table has no
// parent_id column yet (the migration runs by hand in the SQL Editor),
// the write answers 42703 — that turns into a clear Persian message
// instead of breaking anything else. No doc delete exists in the app
// (checked: no deleteDoc anywhere), so the "delete a parent re-roots
// its children" rule has nothing to hook into here; the migration
// itself carries it as `on delete set null` for any future delete.
export async function setDocParent(docRow, newParentId) {
  if (!docRow?.id) throw new Error('سند مشخص نیست.')
  const parent = newParentId || null
  const bad = validateDocParent(ws.docs, docRow.id, parent)
  if (bad) throw new Error(bad)
  if (parent) {
    const parentRow = (ws.docs || []).find((d) => d.id === parent)
    if (parentRow && parentRow.project_id !== docRow.project_id) {
      throw new Error('سند والد باید از همان پروژه باشد.')
    }
  }
  const { error } = await sb
    .from('docs')
    .update({ parent_id: parent })
    .eq('id', docRow.id)
  if (error) {
    if (isMissingColumnError(error)) {
      throw new Error(
        'ستون تودرتویی هنوز روی دادهٔ زنده ساخته نشده است؛ اول مهاجرت را در SQL Editor اجرا کنید.'
      )
    }
    throw error
  }
  await loadDocs(docRow.project_id)
  return { ...docRow, parent_id: parent }
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
  // فاز ۳: متن سادهٔ سند را هم در docs.search_text بنویس تا جست‌وجوی
  // سراسری متن را پیدا کند. این نوشتن از به‌روزرسانی اصلی جداست تا اگر
  // ستون هنوز در دیتابیس زنده نیست (مهاجرت اجرا نشده)، ذخیرهٔ سند
  // نشکند — فقط خطای ستون ناموجود بی‌صدا رد می‌شود (نگهبان بالا).
  const plain = ydoc.getText('content').toString().slice(0, SEARCH_TEXT_MAX_CHARS)
  const { error: serr } = await sb
    .from('docs')
    .update({ search_text: plain })
    .eq('id', docRow.id)
  if (serr && !isMissingColumnError(serr)) throw serr
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
  // RelativePosition has NO .toJSON() in yjs 13.6 (the old call threw
  // «s.toJSON is not a function» and killed every anchored comment —
  // found by the Phase 4 probe; unanchored comments never hit this
  // path, which is why probe-p01-b stayed green). The exported
  // Y.relativePositionToJSON is the serializer that pairs with
  // createRelativePositionFromJSON in resolveAnchor below.
  return {
    start: relStart ? Y.relativePositionToJSON(relStart) : null,
    end: relEnd ? Y.relativePositionToJSON(relEnd) : null,
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

export async function addComment(docId, body, anchor, parentId) {
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
      parent_id: parentId || null,
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
