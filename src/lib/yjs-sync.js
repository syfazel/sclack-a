// Yjs sync layer for sclack_A docs (D4).
//
// Two sync paths, in probe order:
//   1. BroadcastChannel (same browser, all tabs) — live, via y-protocols
//      sync + awareness messages. This is the only LIVE path: edits arrive
//      without reload between tabs of the same browser.
//   2. Row-based snapshot (docs.custom_fields.yjs_state_b64) — cross-browser
//      persistence. A save loads the row first, merges any newer state into
//      the local doc, then writes the merged snapshot (load-merge-write).
//      A Realtime UPDATE subscription on the doc row applies remote saves.
//      This path is NOT live per keystroke: it lands on debounced save
//      (2 s) and on open. Last-write-wins on the snapshot is mitigated by
//      the merge-before-write; it is not a substitute for a server.
//   3. y-websocket server — DOES NOT EXIST. No server is invented, and no
//      code path claims it works. If Broadcast + row ever both fail in a
//      probe, that is reported as a failure (U6), not papered over.
//
// This module is pure Yjs + BroadcastChannel: it imports no Supabase code,
// so the sandbox probe can run it in Node unchanged.

import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

export const MSG_SYNC = 0
export const MSG_AWARENESS = 1

export function channelName(yjsDocId) {
  return 'sclack-a-doc-' + yjsDocId
}

export function createYDoc() {
  const doc = new Y.Doc()
  return { doc, text: doc.getText('content') }
}

// ---------- base64 state codec (row path) ----------

export function encodeDocState(doc) {
  const update = Y.encodeStateAsUpdate(doc)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < update.length; i += chunk) {
    bin += String.fromCharCode.apply(null, update.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export function decodeDocState(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// Apply a row snapshot into the doc. `origin` marks the update so callers
// can tell remote applies apart from local edits.
export function applyDocState(doc, b64, origin) {
  if (!b64) return false
  try {
    Y.applyUpdate(doc, decodeDocState(b64), origin)
    return true
  } catch {
    return false
  }
}

// ---------- BroadcastChannel sync + awareness ----------
// Mirrors the y-websocket provider's message flow, over a BroadcastChannel
// instead of a socket. Returns { channel, awareness, destroy }.

export function connectBroadcast(doc, yjsDocId, localUser) {
  const bc = new BroadcastChannel(channelName(yjsDocId))
  const awareness = new awarenessProtocol.Awareness(doc)
  if (localUser) awareness.setLocalStateField('user', localUser)

  function broadcastSyncMessage(encoder) {
    bc.postMessage(encoding.toUint8Array(encoder))
  }

  function sendSyncStep1() {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MSG_SYNC)
    syncProtocol.writeSyncStep1(encoder, doc)
    broadcastSyncMessage(encoder)
  }

  function sendAwarenessUpdate() {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MSG_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID])
    )
    bc.postMessage(encoding.toUint8Array(encoder))
  }

  // Local doc changes -> broadcast the update (origin null = local edit).
  const onDocUpdate = (update, origin) => {
    if (origin === 'broadcast' || origin === 'row') return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MSG_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    broadcastSyncMessage(encoder)
  }
  doc.on('update', onDocUpdate)

  // Awareness changes (ours or remote-applied) -> rebroadcast ours.
  const onAwarenessUpdate = ({ added, updated, removed }) => {
    const changed = added.concat(updated).concat(removed)
    if (changed.indexOf(awareness.clientID) !== -1) sendAwarenessUpdate()
  }
  awareness.on('update', onAwarenessUpdate)

  bc.onmessage = (event) => {
    const data = event.data
    if (!(data instanceof Uint8Array)) return
    const decoder = decoding.createDecoder(data)
    const type = decoding.readVarUint(decoder)
    if (type === MSG_SYNC) {
      const encoder = encoding.createEncoder()
      syncProtocol.readSyncMessage(decoder, encoder, doc, 'broadcast')
      if (encoding.length(encoder) > 0) {
        // readSyncMessage writes the sync reply WITHOUT our envelope
        // byte (it starts with the y-protocols message type). Prepend it.
        const reply = encoding.toUint8Array(encoder)
        const framed = new Uint8Array(reply.length + 1)
        framed[0] = MSG_SYNC
        framed.set(reply, 1)
        bc.postMessage(framed)
      }
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        decoding.readVarUint8Array(decoder),
        'broadcast'
      )
    }
  }

  // Ask peers for their state, and announce our presence.
  sendSyncStep1()
  sendAwarenessUpdate()

  // Prune stale presence: a peer whose awareness state is older than 30 s
  // is treated as gone (tabs close without a goodbye).
  const pruneTimer = setInterval(() => {
    const now = Date.now()
    const stale = []
    awareness.getStates().forEach((state, clientId) => {
      const meta = awareness.meta.get(clientId)
      if (clientId !== awareness.clientID && meta && now - meta.lastUpdated > 30000) {
        stale.push(clientId)
      }
    })
    if (stale.length > 0) awarenessProtocol.removeAwarenessStates(awareness, stale, 'broadcast')
  }, 10000)

  function destroy() {
    clearInterval(pruneTimer)
    doc.off('update', onDocUpdate)
    awareness.off('update', onAwarenessUpdate)
    awarenessProtocol.removeAwarenessStates(awareness, [awareness.clientID], 'broadcast')
    sendAwarenessUpdate()
    bc.close()
  }

  return { channel: bc, awareness, destroy, sendAwarenessUpdate }
}

// ---------- textarea <-> Y.Text binding ----------
// Local typing is diffed (common prefix/suffix) so remote merges stay
// per-character; remote updates move the caret only when they overlap it.

export function diffToOps(oldStr, newStr) {
  let start = 0
  const minLen = Math.min(oldStr.length, newStr.length)
  while (start < minLen && oldStr[start] === newStr[start]) start++
  let oldEnd = oldStr.length
  let newEnd = newStr.length
  while (
    oldEnd > start &&
    newEnd > start &&
    oldStr[oldEnd - 1] === newStr[newEnd - 1]
  ) {
    oldEnd--
    newEnd--
  }
  return { start, deleteLen: oldEnd - start, insert: newStr.slice(start, newEnd) }
}

export function bindTextarea(textarea, ytext, doc) {
  let applyingRemote = false

  function onLocalInput() {
    if (applyingRemote) return
    const next = textarea.value
    const current = ytext.toString()
    if (next === current) return
    const { start, deleteLen, insert } = diffToOps(current, next)
    doc.transact(() => {
      if (deleteLen > 0) ytext.delete(start, deleteLen)
      if (insert.length > 0) ytext.insert(start, insert)
    })
  }
  textarea.addEventListener('input', onLocalInput)

  // Remote changes only: local edits already moved the caret, and
  // re-applying their delta would shift it twice. The transaction origin
  // is null for local edits, 'broadcast'/'row' for remote applies.
  function onRemoteChange(event, transaction) {
    if (!transaction || !transaction.origin) return
    const selStart = textarea.selectionStart
    const selEnd = textarea.selectionEnd
    const hadFocus =
      typeof document !== 'undefined' && document.activeElement === textarea
    applyingRemote = true
    textarea.value = ytext.toString()
    if (hadFocus && selStart !== null) {
      // Keep the caret where it was, shifted only by remote edits that
      // landed before it; if an edit overlapped the caret, park it at the
      // end of the changed region.
      let pos = 0
      let s = selStart
      let e = selEnd
      for (const op of event.changes.delta) {
        if (op.retain !== undefined) {
          pos += op.retain
        } else if (op.insert !== undefined) {
          const len = typeof op.insert === 'string' ? op.insert.length : 1
          if (pos <= s) s += len
          if (pos <= e) e += len
          pos += len
        } else if (op.delete !== undefined) {
          if (pos + op.delete <= s) s -= op.delete
          else if (pos < s) s = pos
          if (pos + op.delete <= e) e -= op.delete
          else if (pos < e) e = pos
          pos += op.delete
        }
      }
      try {
        textarea.setSelectionRange(s, e)
      } catch {
        // textarea may be hidden; ignore.
      }
    }
    applyingRemote = false
  }
  ytext.observe(onRemoteChange)

  return () => {
    textarea.removeEventListener('input', onLocalInput)
    ytext.unobserve(onRemoteChange)
  }
}
