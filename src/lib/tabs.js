// تب‌های سند — D-UX6 الف (چند تب باز مثل نوشن).
// تب‌ها در وضعیت محلی نگه داشته می‌شوند و در localStorage ذخیره
// می‌شوند تا پس از بارگذاری دوباره برگردند. تب فعال از مسیر جاری
// خوانده می‌شود، نه از وضعیت — پس جابه‌جایی تب یعنی رفتن به مسیر
// همان سند، بدون رفرش. بستن تب سند را نمی‌بندد، فقط تب را می‌بندد.
import { ws } from './store.svelte.js'

const STORAGE_KEY = 'sclack-a-doc-tabs-v1'
const MAX_CLOSED = 10

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

export function restoreDocTabs() {
  const s = storage()
  if (!s) return
  try {
    const raw = s.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      ws.docTabs = parsed.filter((t) => t && typeof t.id === 'string').map((t) => ({ id: t.id, title: t.title || 'سند' }))
    }
  } catch {
    // وضعیت خراب: تب‌ها از اول ساخته می‌شوند.
    ws.docTabs = []
  }
}

function persist() {
  const s = storage()
  if (!s) return
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(ws.docTabs))
  } catch {
    // حافظهٔ محلی پر یا بسته است — تب‌ها فقط در همین نشست می‌مانند.
  }
}

export function openDocTab(id, title) {
  if (!id) return
  const clean = (title || '').trim() || 'سند'
  const i = ws.docTabs.findIndex((t) => t.id === id)
  if (i >= 0) {
    if (ws.docTabs[i].title !== clean) {
      ws.docTabs[i] = { ...ws.docTabs[i], title: clean }
      persist()
    }
    return
  }
  ws.docTabs = [...ws.docTabs, { id, title: clean }]
  persist()
}

// بستن تب: همسایهٔ بعدیِ تب بسته‌شده را برمی‌گرداند تا ناوبری بداند
// کجا برود (null یعنی تبی نمانده — برو به خانه).
export function closeDocTab(id) {
  const i = ws.docTabs.findIndex((t) => t.id === id)
  if (i < 0) return null
  const [closed] = ws.docTabs.splice(i, 1)
  ws.closedDocTabs = [...ws.closedDocTabs, closed].slice(-MAX_CLOSED)
  persist()
  const next = ws.docTabs[Math.min(i, ws.docTabs.length - 1)]
  return next ? next.id : null
}

// Ctrl+Shift+T — بازکردن آخرین تب بسته‌شده.
export function reopenClosedTab() {
  const last = ws.closedDocTabs[ws.closedDocTabs.length - 1]
  if (!last) return null
  ws.closedDocTabs = ws.closedDocTabs.slice(0, -1)
  openDocTab(last.id, last.title)
  return last.id
}
