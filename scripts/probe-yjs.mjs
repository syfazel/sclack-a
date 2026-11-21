// Sandbox probe for the D4 Yjs sync layer (src/lib/yjs-sync.js).
// Runs in Node (no browser, no Supabase, no test data in live tables).
// Criterion (same as the W0 probe): two editors, 35 characters, 0 lost.
// Usage: node scripts/probe-yjs.mjs
import {
  createYDoc,
  connectBroadcast,
  encodeDocState,
  applyDocState,
  diffToOps
} from '../src/lib/yjs-sync.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(name, cond, extra) {
  if (cond) {
    console.log('PASS', name)
  } else {
    failures++
    console.log('FAIL', name, extra ?? '')
  }
}

async function main() {
  // ---- Probe A: BroadcastChannel sync between two editors ----
  const a = createYDoc()
  const b = createYDoc()
  const connA = connectBroadcast(a.doc, 'probe-doc-1', { name: 'آ' })
  const connB = connectBroadcast(b.doc, 'probe-doc-1', { name: 'ب' })
  await sleep(300) // handshake: step1/step2

  const text35 = 'سلام دنیا! این یک پیام آزمایشی است!' // 35 chars (verified below)
  const extra = ' و پنج نویسه'
  console.log('probe text length:', [...text35].length, 'extra length:', [...extra].length)
  if ([...text35].length !== 35) {
    console.log('FAIL probe setup: text35 is not 35 chars')
    process.exit(1)
  }
  a.doc.transact(() => {
    a.text.insert(0, text35)
  })
  await sleep(300)
  check('A->B: 35 chars arrive intact', b.text.toString() === text35, JSON.stringify(b.text.toString()))
  check('A->B: length 35', [...b.text.toString()].length === 35, [...b.text.toString()].length)

  b.doc.transact(() => {
    b.text.insert(b.text.length, extra)
  })
  await sleep(300)
  check('B->A: extra chars arrive', a.text.toString() === text35 + extra, JSON.stringify(a.text.toString()))
  check('A length 35+extra', [...a.text.toString()].length === 35 + [...extra].length, [...a.text.toString()].length)

  // Awareness: B's cursor reaches A.
  connB.awareness.setLocalStateField('cursor', 10)
  await sleep(300)
  let sawB = null
  connA.awareness.getStates().forEach((state, clientId) => {
    if (clientId !== connA.awareness.clientID) sawB = state
  })
  check('awareness: A sees B', sawB !== null)
  check('awareness: B cursor = 10', sawB && sawB.cursor === 10, JSON.stringify(sawB))

  connA.destroy()
  connB.destroy()

  // ---- Probe B: row-state codec (docs.custom_fields.yjs_state_b64) ----
  const c = createYDoc()
  const d = createYDoc()
  c.doc.transact(() => {
    c.text.insert(0, 'abcdefghij')
  })
  const b64 = encodeDocState(c.doc)
  check('row codec: encodes to non-empty base64', typeof b64 === 'string' && b64.length > 0)
  check('row codec: apply returns true', applyDocState(d.doc, b64, 'row') === true)
  check('row codec: D has 10 chars', d.text.toString() === 'abcdefghij', d.text.toString())
  d.doc.transact(() => {
    d.text.insert(10, 'klmnopqrstuvwxy')
  })
  const b64b = encodeDocState(d.doc)
  applyDocState(c.doc, b64b, 'row')
  check('row codec: C has 25 chars after merge', c.text.toString() === 'abcdefghijklmnopqrstuvwxy', c.text.toString())
  check('row codec: garbage rejected', applyDocState(c.doc, '!!!not-base64!!!', 'row') === false)

  // ---- Probe C: textarea diff helper ----
  check('diff empty->hello', JSON.stringify(diffToOps('', 'hello')) === JSON.stringify({ start: 0, deleteLen: 0, insert: 'hello' }))
  check(
    'diff insert middle',
    JSON.stringify(diffToOps('hello world', 'hello brave world')) ===
      JSON.stringify({ start: 6, deleteLen: 0, insert: 'brave ' })
  )
  check(
    'diff replace one',
    JSON.stringify(diffToOps('abc', 'axc')) === JSON.stringify({ start: 1, deleteLen: 1, insert: 'x' })
  )
  check(
    'diff delete tail',
    JSON.stringify(diffToOps('hello!', 'hello')) === JSON.stringify({ start: 5, deleteLen: 1, insert: '' })
  )

  console.log(failures === 0 ? 'ALL PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
