// ستاره (علاقه‌مندی) — D-UX5 الف.
// هر سند/اتاق/پروژه با ستاره به علاقه‌مندی می‌رود و با تپ دوباره
// برمی‌گردد؛ انتخاب در custom_fields.starred همان ردیف ذخیره می‌شود
// (بدون جدول تازه). علاقه‌مندی اشاره‌گر است، نه کپی — برداشتن ستاره
// فقط میان‌بر را حذف می‌کند، نه صفحه را. ردیف محلی هم همان‌جا
// به‌روز می‌شود تا UI بدون رفرش واکنش نشان بدهد.
import { sb } from './supabase.js'
import { ws } from './store.svelte.js'

export function isStarred(row) {
  return !!row?.custom_fields?.starred
}

const LISTS = {
  projects: () => ws.projects,
  rooms: () => ws.rooms,
  docs: () => ws.docs
}

function patchLocal(table, id, customFields) {
  const list = LISTS[table]?.()
  if (!list) return
  const i = list.findIndex((r) => r.id === id)
  if (i >= 0) list[i] = { ...list[i], custom_fields: customFields }
  const pi = (ws.privateDocs || []).findIndex((r) => r.id === id)
  if (pi >= 0) ws.privateDocs[pi] = { ...ws.privateDocs[pi], custom_fields: customFields }
}

export async function toggleStarred(table, row) {
  if (!row?.id) throw new Error('ردیف مشخص نیست.')
  if (!sb) throw new Error('اتصال برقرار نیست.')
  const next = !isStarred(row)
  const cf = { ...(row.custom_fields || {}), starred: next }
  const { data, error } = await sb
    .from(table)
    .update({ custom_fields: cf })
    .eq('id', row.id)
    .select()
    .single()
  if (error) throw error
  patchLocal(table, row.id, data?.custom_fields || cf)
  return { ...row, custom_fields: data?.custom_fields || cf }
}

// همهٔ موارد ستاره‌دارِ دیده‌شده، به ترتیب بخش علاقه‌مندی‌ها:
// سندها، اتاق‌ها، پروژه‌ها — هر کدام با نوع و پیوندش.
export function starredItems() {
  const docs = (ws.docs || []).filter(isStarred).map((d) => ({ kind: 'doc', id: d.id, title: d.title, link: '#/doc/' + d.id }))
  const privates = (ws.privateDocs || []).filter(isStarred).map((d) => ({ kind: 'doc', id: d.id, title: d.title, link: '#/doc/' + d.id }))
  const rooms = (ws.rooms || []).filter(isStarred).map((r) => ({ kind: 'room', id: r.id, title: r.name, link: '#/room/' + r.id }))
  const projects = (ws.projects || []).filter(isStarred).map((p) => ({ kind: 'project', id: p.id, title: p.name, link: null }))
  const seen = new Set()
  return [...docs, ...privates, ...rooms, ...projects].filter((x) => {
    if (seen.has(x.id)) return false
    seen.add(x.id)
    return true
  })
}
