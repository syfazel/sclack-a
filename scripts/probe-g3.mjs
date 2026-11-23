// G3 (home dashboard + team pulse) sandbox probes (Node, no network,
// no live data).
//
// Three layers:
//  1. UNIT — the pure helpers of src/lib/extract.js (faNum,
//     tehranGreeting, tehranWeekDayKeys, computeTeamPulse,
//     computePulseChart, buildRecentActivity) with a PINNED clock
//     (Sunday 2026-11-22 12:00 Tehran), so every expected number is
//     hand-computed below.
//  2. BUNDLE — bento grid + 264px/72px sidebar + .ai-card/.ai-btn in
//     the sources, purple only in .ai- rules, no weather / Upgrade /
//     usage-bar strings anywhere on the home page.
//  3. MOUNT — the REAL built bundle in jsdom with a stubbed Supabase
//     backend: full-data mount (all 9 cards + pulse, exact numbers vs
//     the same pure function, checkbox toggle moves the progress
//     ring, project switcher), empty mount (empty states, no %),
//     fresh mount (no previous-week data -> no % element at all),
//     loading mount (slow pulse queries -> loading state), error mount
//     (failing pulse queries -> error + retry -> recovery), and the
//     no-new-Realtime-channel check (0 WebSocket constructions on the
//     home mount).
//
// HERMETIC BUILD (same as probe-p01-a/b/c/d/s5): this probe BUILDS
// the bundle itself with the probe Supabase URL + placeholder key
// before mounting, and refuses to mount a bundle that is not
// probe-configured.
//
// Usage:
//   node scripts/probe-g3.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import {
  faNum,
  tehranGreeting,
  tehranWeekDayKeys,
  tehranDayKey,
  addTehranDays,
  computeTeamPulse,
  computePulseChart,
  buildRecentActivity,
  pickProgressProjectId,
  buildTodayTimeline,
  tehranTimeLabel
} from '../src/lib/extract.js'

const PLACEHOLDER_KEY = 'sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY'
const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const ZAHRA_USER_ID = '99999999-9999-9999-9999-999999999999'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const MEMBER2_ID = '22222222-2222-2222-2222-222222222223'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const PROJECT2_ID = '33333333-3333-3333-3333-333333333334'
const ROOM_ID = '44444444-4444-4444-4444-444444444444'
const ROOM2_ID = '44444444-4444-4444-4444-444444444445'
const DOC_ID = '55555555-5555-5555-5555-555555555555'
const DOC2_ID = '55555555-5555-5555-5555-555555555556'
const DOC3_ID = '55555555-5555-5555-5555-555555555557'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const allErrors = []
function check(name, cond, extra) {
  if (cond) console.log('PASS', name)
  else {
    failures++
    console.log('FAIL', name, extra ?? '')
  }
}
function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim()
}

// Pinned clock for the unit tests: Sunday 2026-11-22 12:00 Tehran.
// Tehran week (Sat-Fri): 2026-11-21 .. 2026-11-27.
// Chart days (today-6 .. today): 2026-11-16 .. 2026-11-22.
// Previous 7 days: 2026-11-09 .. 2026-11-15.
const PINNED_NOW = new Date('2026-11-22T12:00:00+03:30')
const pinAt = (dayOffset, time) =>
  tehranDayKey(addTehranDays(PINNED_NOW, dayOffset)) + 'T' + time + '+03:30'

// ---------- 1. UNIT: extract.js pure helpers ----------
function unitTests() {
  // faNum
  check('G3 unit: faNum(0) is ۰', faNum(0) === '۰')
  check('G3 unit: faNum(123) is ۱۲۳', faNum(123) === '۱۲۳')
  check('G3 unit: faNum(9) is ۹', faNum(9) === '۹')
  check('G3 unit: faNum(-22) is a Persian -22', faNum(-22).includes('۲۲') && /[-−]/.test(faNum(-22)), faNum(-22))

  // tehranGreeting (pinned Tehran times)
  check('G3 unit: greeting at 05:30 is صبح بخیر', tehranGreeting(new Date('2026-11-22T05:30:00+03:30')) === 'صبح بخیر')
  check('G3 unit: greeting at 11:59 is صبح بخیر', tehranGreeting(new Date('2026-11-22T11:59:00+03:30')) === 'صبح بخیر')
  check('G3 unit: greeting at 12:30 is ظهر بخیر', tehranGreeting(new Date('2026-11-22T12:30:00+03:30')) === 'ظهر بخیر')
  check('G3 unit: greeting at 15:00 is عصر بخیر', tehranGreeting(new Date('2026-11-22T15:00:00+03:30')) === 'عصر بخیر')
  check('G3 unit: greeting at 18:59 is عصر بخیر', tehranGreeting(new Date('2026-11-22T18:59:00+03:30')) === 'عصر بخیر')
  check('G3 unit: greeting at 21:00 is شب بخیر', tehranGreeting(new Date('2026-11-22T21:00:00+03:30')) === 'شب بخیر')
  check('G3 unit: greeting at 04:00 is شب بخیر', tehranGreeting(new Date('2026-11-22T04:00:00+03:30')) === 'شب بخیر')

  // tehranWeekDayKeys (Sunday 2026-11-22 -> week starts Sat 2026-11-21)
  const wk = tehranWeekDayKeys(PINNED_NOW)
  check('G3 unit: week has 7 keys, Sat 2026-11-21 .. Fri 2026-11-27',
    wk.length === 7 && wk[0] === '2026-11-21' && wk[6] === '2026-11-27', JSON.stringify(wk))
  check('G3 unit: week contains today',
    wk.includes('2026-11-22'))

  // computeTeamPulse (hand-computed expectations for the pinned clock)
  const messages = [
    // today (2026-11-22) x3
    { created_at: pinAt(0, '09:00:00') },
    { created_at: pinAt(0, '10:00:00') },
    { created_at: pinAt(0, '11:00:00') },
    // yesterday (2026-11-21) x2
    { created_at: pinAt(-1, '09:00:00') },
    { created_at: pinAt(-1, '10:00:00') },
    // today-3 (2026-11-19) x1
    { created_at: pinAt(-3, '09:00:00') },
    // today-6 (2026-11-16) x1
    { created_at: pinAt(-6, '09:00:00') },
    // previous 7 days: today-8 (2026-11-14) x5, today-10 (2026-11-12) x4
    { created_at: pinAt(-8, '09:00:00') },
    { created_at: pinAt(-8, '10:00:00') },
    { created_at: pinAt(-8, '11:00:00') },
    { created_at: pinAt(-8, '12:00:00') },
    { created_at: pinAt(-8, '13:00:00') },
    { created_at: pinAt(-10, '09:00:00') },
    { created_at: pinAt(-10, '10:00:00') },
    { created_at: pinAt(-10, '11:00:00') },
    { created_at: pinAt(-10, '12:00:00') },
    // no created_at -> ignored
    { created_at: null }
  ]
  const tasks = [
    { status: 'done', completed_at: pinAt(0, '10:00:00') }, // today
    { status: 'done', completed_at: pinAt(-1, '10:00:00') }, // Sat 2026-11-21 = week start, this week + chart day -1
    { status: 'done', completed_at: pinAt(-10, '10:00:00') }, // 2026-11-12, previous 7 days
    { status: 'todo', completed_at: null },
    { status: 'done', completed_at: null } // done without a date -> counted nowhere
  ]
  const docs = [
    { updated_at: pinAt(0, '11:00:00') }, // active
    { updated_at: '2026-11-15T13:00:00+03:30' }, // 6d23h ago -> active
    { updated_at: '2026-11-14T12:00:00+03:30' }, // 8d ago -> not active
    { updated_at: null } // excluded
  ]
  const files = [
    { uploaded_at: pinAt(0, '11:00:00') },
    { uploaded_at: '2026-11-16T13:00:00+03:30' }, // 5d23h ago -> new
    { uploaded_at: '2026-11-14T12:00:00+03:30' }, // 8d ago -> not new
    { uploaded_at: null }
  ]
  const p = computeTeamPulse({ messages, tasks, docs, files }, PINNED_NOW)
  check('G3 unit: todayMessages is 3', p.todayMessages === 3, String(p.todayMessages))
  check('G3 unit: doneThisWeek is 2 (today + Saturday week-start)',
    p.doneThisWeek === 2, String(p.doneThisWeek))
  check('G3 unit: activeDocs is 2 (7x24h window)', p.activeDocs === 2, String(p.activeDocs))
  check('G3 unit: newFiles is 2 (7-day window)', p.newFiles === 2, String(p.newFiles))
  check('G3 unit: chart days messages are [1,0,0,1,0,2,3]',
    JSON.stringify(p.days.map((d) => d.messages)) === '[1,0,0,1,0,2,3]',
    JSON.stringify(p.days.map((d) => d.messages)))
  check('G3 unit: chart days done are [0,0,0,0,0,1,1]',
    JSON.stringify(p.days.map((d) => d.done)) === '[0,0,0,0,0,1,1]',
    JSON.stringify(p.days.map((d) => d.done)))
  check('G3 unit: prevMessages is 9', p.prevMessages === 9, String(p.prevMessages))
  check('G3 unit: prevDone is 1', p.prevDone === 1, String(p.prevDone))
  check('G3 unit: changeMessages is -22 ((7-9)/9)',
    p.changeMessages === -22, String(p.changeMessages))
  check('G3 unit: changeDone is 100 ((2-1)/1)', p.changeDone === 100, String(p.changeDone))

  // Empty input -> zeros + null change rates (no fake %).
  const pe = computeTeamPulse({ messages: [], tasks: [], docs: [], files: [] }, PINNED_NOW)
  check('G3 unit: empty input gives all zeros',
    pe.todayMessages === 0 && pe.doneThisWeek === 0 && pe.activeDocs === 0 && pe.newFiles === 0 &&
    pe.days.every((d) => d.messages === 0 && d.done === 0))
  check('G3 unit: empty input gives null change rates (no % element)',
    pe.changeMessages === null && pe.changeDone === null)

  // No previous-week data -> null change rates even with current data.
  const pf = computeTeamPulse(
    {
      messages: [{ created_at: pinAt(0, '09:00:00') }, { created_at: pinAt(-1, '09:00:00') }],
      tasks: [{ status: 'done', completed_at: pinAt(0, '10:00:00') }],
      docs: [],
      files: []
    },
    PINNED_NOW
  )
  check('G3 unit: no previous-week data -> null change rates',
    pf.changeMessages === null && pf.changeDone === null &&
    pf.todayMessages === 1 && pf.doneThisWeek === 1)

  // computePulseChart
  const c = computePulseChart(p.days)
  check('G3 unit: chart is 600x180', c.width === 600 && c.height === 180)
  // H1-5: the y-axis max is at least 5, so one message is not a mountain.
  check('G3 unit: chart max is 5 (floor) when the largest daily value is 3', c.max === 5, String(c.max))
  check('G3 unit: messages polyline has 7 points',
    c.messagesPoints.split(' ').length === 7, c.messagesPoints)
  check('G3 unit: done polyline has 7 points',
    c.donePoints.split(' ').length === 7, c.donePoints)
  check('G3 unit: x is reversed — oldest day on the right, today on the left',
    c.labels[0].x > c.labels[6].x, JSON.stringify(c.labels.map((l) => l.x)))
  check('G3 unit: a value of 3 sits at y=68.8 with the max floor of 5 (not at the top), zero at the baseline (y=154)',
    c.messagesPoints.split(' ')[6] === '8.0,68.8' &&
    c.messagesPoints.split(' ')[1] === '464.7,154.0',
    c.messagesPoints)
  check('G3 unit: gridlines are 0 / 3 / 5 with readable y values (5 at the top, 0 at the baseline)',
    JSON.stringify(c.gridlines.map((g) => g.value)) === '[0,3,5]' &&
    c.gridlines[2].y === 12 && c.gridlines[0].y === 154,
    JSON.stringify(c.gridlines))
  // A single message in a week must not draw a mountain.
  const c1 = computePulseChart(p.days.map((d, i) => ({ ...d, messages: i === 6 ? 1 : 0, done: 0 })))
  check('G3 unit: one message peaks at y=125.6, far below the top (y=12)',
    c1.max === 5 && c1.messagesPoints.split(' ')[6] === '8.0,125.6',
    c1.messagesPoints)
  // H1-4: pickProgressProjectId — current project wins, else the first
  // project with tasks, else the first project, else null.
  const pp = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]
  const pt = [{ project_id: 'p2' }, { project_id: 'p3' }]
  check('H1 unit: current project wins when it is in the list',
    pickProgressProjectId(pp, pt, 'p3') === 'p3')
  check('H1 unit: without a current project, the first project with tasks wins',
    pickProgressProjectId(pp, pt, null) === 'p2')
  check('H1 unit: with no tasks anywhere, the first project wins',
    pickProgressProjectId(pp, [], null) === 'p1')
  check('H1 unit: unknown current project falls back to the first project with tasks',
    pickProgressProjectId(pp, pt, 'pX') === 'p2')
  check('H1 unit: no projects gives null',
    pickProgressProjectId([], pt, null) === null)
  // H3-1: buildTodayTimeline — today + overdue only, mine only, max 5,
  // ordered by time; tehranTimeLabel is HH:MM in Tehran.
  const tl = buildTodayTimeline(
    {
      tasks: [
        { id: 'a', title: 'کار امروز صبح', status: 'todo', assignee_id: MEMBER_ID, due_at: pinAt(0, '09:00:00') },
        { id: 'b', title: 'کار عقب‌مانده', status: 'todo', assignee_id: MEMBER_ID, due_at: pinAt(-1, '15:00:00') },
        { id: 'c', title: 'کار فردا', status: 'todo', assignee_id: MEMBER_ID, due_at: pinAt(1, '09:00:00') },
        { id: 'd', title: 'کار تمام‌شده', status: 'done', assignee_id: MEMBER_ID, due_at: pinAt(0, '10:00:00') },
        { id: 'e', title: 'کار نفر دوم', status: 'todo', assignee_id: MEMBER2_ID, due_at: pinAt(0, '08:00:00') },
        { id: 'f', title: 'کار بی‌سررسید', status: 'todo', assignee_id: MEMBER_ID, due_at: null }
      ],
      reminders: [
        { id: 'r1', text: 'یادآوری امروز', remind_at: pinAt(0, '18:00:00'), done: false },
        { id: 'r2', text: 'یادآوری فردا', remind_at: pinAt(1, '09:00:00'), done: false },
        { id: 'r3', text: 'یادآوری انجام‌شده', remind_at: pinAt(0, '07:00:00'), done: true }
      ]
    },
    PINNED_NOW,
    { meId: MEMBER_ID }
  )
  check('H3 unit: timeline keeps today + overdue, mine only, by time',
    JSON.stringify(tl.map((x) => x.id)) === JSON.stringify(['b', 'a', 'r1']),
    JSON.stringify(tl.map((x) => x.id)))
  check('H3 unit: overdue item is flagged, today items are not',
    tl[0].overdue === true && tl[1].overdue === false && tl[2].overdue === false)
  check('H3 unit: reminder title comes from text',
    tl[2].kind === 'reminder' && tl[2].title === 'یادآوری امروز')
  check('H3 unit: timeline caps at 5, earliest first',
    JSON.stringify(buildTodayTimeline(
      { tasks: [0, 1, 2, 3, 4, 5].map((i) => ({ id: 't' + i, title: 'کار ' + i, status: 'todo', assignee_id: MEMBER_ID, due_at: pinAt(0, '0' + i + ':00:00') })), reminders: [] },
      PINNED_NOW, { meId: MEMBER_ID }
    ).map((x) => x.id)) === JSON.stringify(['t0', 't1', 't2', 't3', 't4']))
  check('H3 unit: tehranTimeLabel is HH:MM in Tehran, Persian digits',
    tehranTimeLabel('2026-11-22T14:30:00+03:30') === '۱۴:۳۰',
    tehranTimeLabel('2026-11-22T14:30:00+03:30'))
  check('G3 unit: labels are Jalali short days',
    c.labels.every((l) => typeof l.label === 'string' && l.label.length > 0) &&
    c.labels[6].label === '۱ آذر', JSON.stringify(c.labels.map((l) => l.label)))

  // buildRecentActivity
  const nameOf = (id) => (id === MEMBER_ID ? 'یاسین' : id === MEMBER2_ID ? 'زهرا' : 'عضو')
  const act = buildRecentActivity(
    {
      tasks: [
        { id: 'a', title: 'کار الف', status: 'done', assignee_id: MEMBER_ID, created_by: MEMBER_ID, created_at: '2026-11-22T09:00:00+03:30', completed_at: '2026-11-22T11:00:00+03:30' },
        { id: 'b', title: 'کار ب', status: 'todo', assignee_id: MEMBER2_ID, created_by: MEMBER2_ID, created_at: '2026-11-22T10:00:00+03:30', completed_at: null }
      ],
      docs: [
        { id: 'd1', title: 'سند یک', created_by: MEMBER_ID, created_at: '2026-11-20T09:00:00+03:30', updated_at: '2026-11-22T10:30:00+03:30' },
        { id: 'd2', title: 'سند دو', created_by: MEMBER2_ID, created_at: '2026-11-22T08:00:00+03:30', updated_at: '2026-11-22T08:00:00+03:30' }
      ],
      versions: [
        { id: 'v1', doc_id: 'd1', version_no: 2, author_id: MEMBER_ID, created_at: '2026-11-22T11:30:00+03:30' }
      ]
    },
    nameOf,
    PINNED_NOW,
    5
  )
  check('G3 unit: activity merges to 5 newest, newest first',
    act.length === 5 && act[0].text.includes('نسخهٔ ۲') &&
    act[3].text.includes('کار «کار ب»') && act[4].text.includes('کار «کار الف» را ساخت'),
    JSON.stringify(act.map((a) => a.actor + ' ' + a.text)))
  check('G3 unit: activity actors come from nameOf',
    act[0].actor === 'یاسین' && act.some((a) => a.actor === 'زهرا'))
  check('G3 unit: doc with updated_at > created_at is «ویرایش کرد», equal is «ساخت»',
    act.some((a) => a.text.includes('سند «سند یک» را ویرایش کرد')) &&
    !act.some((a) => a.text.includes('سند «سند دو» را ویرایش کرد')))
  check('G3 unit: version label uses Persian digits',
    act[0].text.includes('نسخهٔ ۲'))
}

// ---------- stub backend (adapted from probe-p01-s5; GET/POST/PATCH/DELETE) ----------
// The stub can fail or delay the workspace-wide PULSE queries only:
// loadTeamPulseData() marks every one of its six queries with an
// explicit .limit(), while the project-scoped loaders never use
// limit — so `limit` on a pulse table (messages/tasks/docs/files/
// versions/rooms) identifies a pulse query. That is how the loading
// and error mounts are driven without touching the workspace load.
const PULSE_TABLES = ['messages', 'tasks', 'docs', 'files', 'versions', 'rooms']

function makeDb() {
  const now = new Date().toISOString()
  return {
    members: [
      { id: MEMBER2_ID, muse_id: 'auth:' + ZAHRA_USER_ID, name: 'زهرا', avatar: null, joined_at: now, auth_id: ZAHRA_USER_ID }
    ],
    projects: [],
    rooms: [],
    docs: [],
    messages: [],
    files: [],
    tasks: [],
    comments: [],
    templates: [],
    versions: [],
    reminders: [],
    notifications: [],
    integrations: []
  }
}

function seedG3(db) {
  const now = new Date()
  const iso = (d) => new Date(d).toISOString()
  const isoAt = (dayOffset, time) => tehranDayKey(addTehranDays(now, dayOffset)) + 'T' + time + '+03:30'
  const hoursAgo = (h) => new Date(now.getTime() - h * 3600 * 1000).toISOString()
  const daysAgo = (d) => new Date(now.getTime() - d * 24 * 3600 * 1000).toISOString()

  db.projects.push(
    { id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ پروب G3', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'team', archived: false, custom_fields: { goal: 'هدف G3', deadline: iso(now), stage: 'active', member_ids: [MEMBER_ID, MEMBER2_ID] } },
    { id: PROJECT2_ID, workspace_id: 'main', name: 'پروژهٔ خالی', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'team', archived: false, custom_fields: { goal: 'هدف خالی', deadline: iso(now), stage: 'created', member_ids: [MEMBER_ID, MEMBER2_ID] } }
  )
  db.rooms.push(
    { id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'project', custom_fields: {} },
    { id: ROOM2_ID, project_id: PROJECT2_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'project', custom_fields: {} }
  )
  db.docs.push(
    { id: DOC_ID, project_id: PROJECT_ID, title: 'سند تازه', yjs_doc_id: 'doc-g3-1', template_id: null, created_by: MEMBER_ID, created_at: daysAgo(2), updated_at: hoursAgo(1), version: 1, visibility: 'project', custom_fields: { starred: true } },
    { id: DOC2_ID, project_id: PROJECT_ID, title: 'سند قدیمی', yjs_doc_id: 'doc-g3-2', template_id: null, created_by: MEMBER_ID, created_at: daysAgo(12), updated_at: daysAgo(10), version: 1, visibility: 'project', custom_fields: {} },
    { id: DOC3_ID, project_id: PROJECT2_ID, title: 'سند خالی', yjs_doc_id: 'doc-g3-3', template_id: null, created_by: MEMBER_ID, created_at: hoursAgo(0.5), updated_at: hoursAgo(0.5), version: 1, visibility: 'project', custom_fields: {} }
  )
  // My tasks: T1 todo today, T2 doing today, T3 todo tomorrow,
  // T4 done today, T5 todo +3d, T6 todo no due, T7 Zahra's today,
  // T8 done 2d ago, T9 done 10d ago; T10 (P2) todo today.
  const task = (id, project, title, assignee, status, due, completed, created) => ({
    id, project_id: project, title, description: null, assignee_id: assignee, status,
    due_at: due, completed_at: completed, created_by: MEMBER_ID, created_at: created,
    visibility: 'project', custom_fields: {}
  })
  db.tasks.push(
    task('t1', PROJECT_ID, 'کار ۱', MEMBER_ID, 'todo', isoAt(0, '23:59:00'), null, hoursAgo(2)),
    task('t2', PROJECT_ID, 'کار ۲', MEMBER_ID, 'doing', isoAt(0, '23:59:00'), null, hoursAgo(3)),
    task('t3', PROJECT_ID, 'کار ۳', MEMBER_ID, 'todo', isoAt(1, '23:59:00'), null, hoursAgo(4)),
    task('t4', PROJECT_ID, 'کار ۴', MEMBER_ID, 'done', isoAt(0, '23:59:00'), isoAt(0, '10:00:00'), hoursAgo(5)),
    task('t5', PROJECT_ID, 'کار ۵', MEMBER_ID, 'todo', isoAt(3, '23:59:00'), null, hoursAgo(6)),
    task('t6', PROJECT_ID, 'کار ۶', MEMBER_ID, 'todo', null, null, hoursAgo(7)),
    task('t7', PROJECT_ID, 'کار ۷', MEMBER2_ID, 'todo', isoAt(0, '23:59:00'), null, hoursAgo(2)),
    task('t8', PROJECT_ID, 'کار ۸', MEMBER_ID, 'done', isoAt(-2, '23:59:00'), isoAt(-2, '10:00:00'), daysAgo(3)),
    task('t9', PROJECT_ID, 'کار ۹', MEMBER_ID, 'done', isoAt(-10, '23:59:00'), isoAt(-10, '10:00:00'), daysAgo(11)),
    task('t10', PROJECT2_ID, 'کار ۱۰', MEMBER_ID, 'todo', isoAt(0, '23:59:00'), null, hoursAgo(1))
  )
  // Messages: today x3, yesterday x2, -3d x1, -6d x1, -8d x5, -10d x4.
  const msg = (id, dayOffset, time, author) => ({
    id, room_id: ROOM_ID, author_id: author, body: 'پیام ' + id, visibility: 'project',
    created_at: isoAt(dayOffset, time)
  })
  db.messages.push(
    msg('m1', 0, '09:00:00', MEMBER2_ID),
    msg('m2', 0, '10:00:00', MEMBER2_ID),
    msg('m3', 0, '11:00:00', MEMBER_ID),
    msg('m4', -1, '09:00:00', MEMBER2_ID),
    msg('m5', -1, '10:00:00', MEMBER_ID),
    msg('m6', -3, '09:00:00', MEMBER_ID),
    msg('m7', -6, '09:00:00', MEMBER2_ID),
    msg('m8', -8, '09:00:00', MEMBER_ID),
    msg('m9', -8, '10:00:00', MEMBER_ID),
    msg('m10', -8, '11:00:00', MEMBER_ID),
    msg('m11', -8, '12:00:00', MEMBER_ID),
    msg('m12', -8, '13:00:00', MEMBER_ID),
    msg('m13', -10, '09:00:00', MEMBER_ID),
    msg('m14', -10, '10:00:00', MEMBER_ID),
    msg('m15', -10, '11:00:00', MEMBER_ID),
    msg('m16', -10, '12:00:00', MEMBER_ID)
  )
  // Files: F1..F5 in the last 7 days, F6 10 days ago (outside newFiles).
  for (let i = 1; i <= 6; i++) {
    db.files.push({
      id: 'f' + i, project_id: PROJECT_ID, name: 'فایل ' + faNum(i), size: i * 1000,
      uploaded_by: MEMBER_ID, uploaded_at: i === 6 ? daysAgo(10) : hoursAgo(i),
      path: PROJECT_ID + '/file' + i, visibility: 'project', custom_fields: {}
    })
  }
  db.versions.push(
    { id: 'v1', doc_id: DOC_ID, version_no: 2, snapshot_ref: null, author_id: MEMBER_ID, note: null, created_at: hoursAgo(0.5) },
    { id: 'v2', doc_id: DOC_ID, version_no: 1, snapshot_ref: null, author_id: MEMBER_ID, note: null, created_at: daysAgo(2) }
  )
  db.reminders.push(
    { id: 'r1', user_id: MEMBER_ID, text: 'یادآوری پروب', remind_at: isoAt(0, '18:00:00'), done: false, created_at: hoursAgo(1) },
    { id: 'r2', user_id: MEMBER_ID, text: 'یادآوری فردا', remind_at: isoAt(1, '09:00:00'), done: false, created_at: hoursAgo(1) }
  )
  db.notifications.push(
    { id: 'n1', user_id: MEMBER_ID, type: 'mention', target_id: 'm1', read: false, created_at: hoursAgo(0.5) },
    { id: 'n2', user_id: MEMBER_ID, type: 'mention', target_id: 'm2', read: false, created_at: hoursAgo(0.7) },
    { id: 'n3', user_id: MEMBER_ID, type: 'mention', target_id: 'm3', read: true, created_at: hoursAgo(0.8) },
    { id: 'n4', user_id: MEMBER_ID, type: 'reply', target_id: 'm1', read: false, created_at: hoursAgo(0.3) }
  )
}

// Fresh seed: data only in the last 7 days — previous-week sums are 0,
// so no weekly-change % element may exist at all.
function seedFresh(db) {
  const now = new Date()
  const iso = (d) => new Date(d).toISOString()
  const isoAt = (dayOffset, time) => tehranDayKey(addTehranDays(now, dayOffset)) + 'T' + time + '+03:30'
  db.projects.push(
    { id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ تازه', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'team', archived: false, custom_fields: { goal: 'هدف', deadline: iso(now), stage: 'active', member_ids: [MEMBER_ID] } }
  )
  db.rooms.push(
    { id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'project', custom_fields: {} }
  )
  db.messages.push(
    { id: 'm1', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'پیام تازه', visibility: 'project', created_at: isoAt(0, '09:00:00') },
    { id: 'm2', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'پیام دیروز', visibility: 'project', created_at: isoAt(-1, '09:00:00') }
  )
  db.tasks.push(
    { id: 't1', project_id: PROJECT_ID, title: 'کار تازه', description: null, assignee_id: MEMBER_ID, status: 'done', due_at: isoAt(0, '23:59:00'), completed_at: isoAt(0, '10:00:00'), created_by: MEMBER_ID, created_at: iso(now), visibility: 'project', custom_fields: {} }
  )
  db.docs.push(
    { id: DOC_ID, project_id: PROJECT_ID, title: 'سند تازه', yjs_doc_id: 'doc-g3-fresh', template_id: null, created_by: MEMBER_ID, created_at: iso(now), updated_at: iso(now), version: 1, visibility: 'project', custom_fields: {} }
  )
  db.files.push(
    { id: 'f1', project_id: PROJECT_ID, name: 'فایل تازه', size: 1000, uploaded_by: MEMBER_ID, uploaded_at: iso(now), path: PROJECT_ID + '/fresh', visibility: 'project', custom_fields: {} }
  )
}

function makeStub(db, opts = {}) {
  function rowMatches(row, params) {
    for (const [key, val] of params.entries()) {
      if (['select', 'order', 'limit', 'offset', 'or'].includes(key)) continue
      const m = val.match(/^([a-z_]+)\.(.*)$/)
      if (!m) continue
      const [, op, raw] = m
      const v = row[key]
      if (op === 'eq') {
        if (String(v) !== raw && !(v === false && raw === 'false') && !(v === true && raw === 'true')) return false
      } else if (op === 'neq') {
        if (String(v) === raw) return false
      }
    }
    return true
  }
  function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  }
  async function handleRest(url, method, headers, bodyText) {
    const u = new URL(url)
    const table = u.pathname.split('/').pop()
    const params = u.searchParams
    const single = (headers.get('accept') || '').includes('vnd.pgrst.object+json')
    const order = params.get('order') || ''
    const rows = db[table]
    if (!rows) return json({ message: 'table not found: ' + table }, 404)
    if (method === 'GET') {
      // Pulse-query failure/delay: only GETs on the six pulse tables
      // that carry a limit (loadTeamPulseData marks all of its queries).
      const isPulseQuery = PULSE_TABLES.includes(table) && params.get('limit')
      if (isPulseQuery && opts.failPulse) {
        return json({ message: 'probe: pulse query failed', code: 'PGRST000' }, 500)
      }
      if (isPulseQuery && opts.slowPulse) await sleep(1500)
      let out = rows.filter((r) => rowMatches(r, params))
      if (order) {
        const [col, dir] = order.split('.')
        out = [...out].sort((a, b) => {
          const av = a[col] ?? ''
          const bv = b[col] ?? ''
          return dir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv))
        })
      }
      const limit = params.get('limit')
      if (limit) out = out.slice(0, Number(limit))
      out = out.map((r) => {
        const c = { ...r }
        if (table === 'messages') {
          const room = db.rooms.find((x) => x.id === r.room_id)
          c.rooms = room ? { name: room.name } : null
        }
        if (['docs', 'files', 'tasks'].includes(table)) {
          const p = db.projects.find((x) => x.id === r.project_id)
          c.projects = p ? { name: p.name } : null
        }
        return c
      })
      if (single) {
        if (out.length !== 1) return json({ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, 406)
        return json(out[0])
      }
      return json(out)
    }
    if (method === 'POST') {
      const body = bodyText ? JSON.parse(bodyText) : {}
      const onConflict = params.get('on_conflict') || params.get('onConflict')
      const now = new Date().toISOString()
      const row = { ...body }
      if (table === 'projects' && row.archived === undefined) row.archived = false
      if (table === 'projects' && row.custom_fields === undefined) row.custom_fields = {}
      if (!row.id) {
        if (table === 'members' && body.auth_id === USER_ID) row.id = MEMBER_ID
        else if (table === 'members' && body.auth_id === ZAHRA_USER_ID) row.id = MEMBER2_ID
        else row.id = 'stub-' + Math.random().toString(36).slice(2, 10)
      }
      if (!row.created_at) row.created_at = now
      if (onConflict) {
        const existing = rows.find((r) => String(r[onConflict]) === String(body[onConflict]))
        if (existing) {
          Object.assign(existing, row)
          return single ? json(existing) : json([existing])
        }
      }
      rows.push(row)
      return single ? json(row) : json([row])
    }
    if (method === 'PATCH') {
      const body = bodyText ? JSON.parse(bodyText) : {}
      const matched = rows.filter((r) => rowMatches(r, params))
      for (const r of matched) Object.assign(r, body)
      if (single) return matched.length === 1 ? json(matched[0]) : json({ message: 'JSON object requested, multiple (or no) rows returned' }, 406)
      return new Response(null, { status: 204 })
    }
    if (method === 'DELETE') {
      const matched = rows.filter((r) => rowMatches(r, params))
      for (const r of matched) {
        const i = rows.indexOf(r)
        if (i >= 0) rows.splice(i, 1)
      }
      return json(matched)
    }
    return json({ message: 'unsupported method ' + method }, 405)
  }
  async function stubFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url
    const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase()
    const headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {})
    const rawBody = init.body || (typeof input !== 'string' && input.body) || null
    const bodyText = typeof rawBody === 'string' ? rawBody : null
    if (url.startsWith(BASE_URL + '/rest/v1/')) return handleRest(url, method, headers, bodyText)
    if (url.startsWith(BASE_URL + '/auth/v1/')) return json({})
    return json({ error: 'stub: unknown url ' + url }, 404)
  }
  return { stubFetch, db, opts }
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}
function fakeSession(userId = USER_ID, email = 'yasin@probe.test') {
  const jwt = b64url({ alg: 'none', typ: 'JWT' }) + '.' +
    b64url({ sub: userId, email, aud: 'authenticated', exp: 9999999999 }) + '.sig'
  return {
    access_token: jwt,
    refresh_token: 'fake-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: { id: userId, email, aud: 'authenticated', role: 'authenticated' }
  }
}

function loadBundle() {
  const distDir = new URL('../dist/', import.meta.url).pathname
  const html = readFileSync(distDir + 'index.html', 'utf8')
  const jsFile = readdirSync(distDir + 'assets').find((f) => f.startsWith('index-') && f.endsWith('.js'))
  if (!jsFile) throw new Error('no JS asset in dist/assets')
  return { html, js: readFileSync(distDir + 'assets/' + jsFile, 'utf8'), jsFile }
}

function buildProbeBundle() {
  console.log('building probe bundle (probe URL + placeholder key)…')
  try {
    execFileSync('npm', ['run', 'build'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: {
        ...process.env,
        VITE_SUPABASE_URL: BASE_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: PLACEHOLDER_KEY
      },
      stdio: 'inherit'
    })
  } catch (e) {
    throw new Error('probe build failed (npm run build): ' + (e.message || e))
  }
}

function assertProbeConfigured(js) {
  if (!js.includes('probe-ref')) {
    throw new Error('probe bundle is NOT probe-configured: built bundle has no probe-ref URL')
  }
  if (!js.includes(PLACEHOLDER_KEY)) {
    throw new Error('probe bundle is NOT probe-configured: built bundle has no placeholder key')
  }
}

async function mountApp({ html, js }, stub, hash, session = fakeSession()) {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.message || e)))
  virtualConsole.on('error', (msg) => errors.push('console.error: ' + String(msg)))
  const dom = new JSDOM(html, {
    url: 'http://localhost/sclack-a/' + hash,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  })
  const w = dom.window
  if (!w.fetch) w.fetch = fetch
  if (!w.Headers) w.Headers = Headers
  if (!w.Request) w.Request = Request
  if (!w.Response) w.Response = Response
  if (!w.BroadcastChannel && typeof BroadcastChannel !== 'undefined') w.BroadcastChannel = BroadcastChannel
  // Count WebSocket constructions: the home page must open NO new
  // Realtime channel (G3-7) — any construction here is a regression.
  let wsCreated = 0
  w.WebSocket = class {
    constructor() { wsCreated++; this.readyState = 0 }
    addEventListener() {}
    removeEventListener() {}
    send() {}
    close() {}
  }
  w.fetch = stub.stubFetch
  w.confirm = () => true
  if (session) w.localStorage.setItem('sb-probe-ref-auth-token', JSON.stringify(session))
  w.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e)))
  try {
    // jsdom evals the bundle as a CLASSIC script, but Vite's
    // dynamic-import helper uses import.meta (valid only in modules).
    // Patch the occurrences in the eval'd copy only — the real browser
    // loads the bundle as a module, where import.meta works. Rollup
    // also emits a trailing facade export for chunk sharing — a
    // top-level export is a parse error in a classic script, so strip
    // it from the eval'd copy only.
    const jsForEval = js
      .replaceAll('import.meta.resolve', 'void 0')
      .replaceAll('import.meta.url', "'http://localhost/'")
      .replace(/export\{[^}]*\};?\s*$/, '')
    w.eval(jsForEval)
  } catch (e) {
    errors.push('eval threw: ' + (e.message || e))
  }
  return { dom, w, errors, wsCreated: () => wsCreated }
}

async function waitFor(w, fn, timeoutMs = 10000, label = 'condition') {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const v = fn()
      if (v) return v
    } catch { /* retry */ }
    await sleep(150)
  }
  const screen = (w.document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 400)
  throw new Error('timeout waiting for ' + label + ' — screen shows: ' + JSON.stringify(screen))
}

function clickButton(w, scope, label) {
  const btn = [...(scope || w.document).querySelectorAll('button')].find(
    (b) => b.textContent.trim() === label
  )
  if (!btn) throw new Error('button not found: ' + label)
  btn.click()
  return btn
}

function setInput(w, el, value) {
  el.value = value
  el.dispatchEvent(new w.Event('input', { bubbles: true }))
}

// ---------- main ----------
async function main() {
  unitTests()

  buildProbeBundle()
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')
  assertProbeConfigured(js)

  // ---- bundle/source checks ----
  const srcDir = new URL('../src/', import.meta.url).pathname
  const homeSrc = readFileSync(srcDir + 'components/HomeView.svelte', 'utf8')
  const sidebarSrc = readFileSync(srcDir + 'components/Sidebar.svelte', 'utf8')
  const dataSrc = readFileSync(srcDir + 'lib/data.js', 'utf8')
  const cssFile = readdirSync(new URL('../dist/assets/', import.meta.url).pathname)
    .find((f) => f.startsWith('index-') && f.endsWith('.css'))
  const css = cssFile ? readFileSync(new URL('../dist/assets/' + cssFile, import.meta.url).pathname, 'utf8') : ''
  check('G3 bundle: bento grid (12 cols desktop / 2 tablet / 1 mobile) in HomeView',
    homeSrc.includes('data-home-bento') &&
    homeSrc.includes('grid-cols-1') && homeSrc.includes('md:grid-cols-2') && homeSrc.includes('lg:grid-cols-12'))
  check('G3 bundle: desktop placement 12 / 5+4+3 / 7+5 / 4+4+4',
    homeSrc.includes('lg:col-span-12') &&
    homeSrc.includes('lg:col-start-1') && homeSrc.includes('lg:col-span-5') &&
    homeSrc.includes('lg:col-start-6') && homeSrc.includes('lg:col-span-4') &&
    homeSrc.includes('lg:col-start-10') && homeSrc.includes('lg:col-span-3') &&
    homeSrc.includes('lg:col-span-7') && homeSrc.includes('lg:col-start-8'))
  check('H2 bundle: all 10 home cards + pulse have data-home-card',
    ['mentions', 'my-tasks', 'progress', 'recent-docs', 'activity', 'favorites', 'reminders', 'files', 'assistant', 'pulse']
      .every((c) => homeSrc.includes('data-home-card="' + c + '"')))
  check('G3 bundle: no weather card and no Upgrade card is built',
    !homeSrc.includes('آب‌وهوا') && !homeSrc.toLowerCase().includes('upgrade') && !homeSrc.includes('ارتقا'))
  check('G3 bundle: no usage-percentage bar is built',
    !homeSrc.includes('درصد مصرف') && !homeSrc.includes('usage'))
  check('G3 bundle: sidebar is 72px icon-only at md, 264px at lg',
    sidebarSrc.includes('w-[72px]') && sidebarSrc.includes('lg:w-[264px]'))
  check('G3 bundle: .ai-card and .ai-btn rules exist in CSS',
    css.includes('.ai-card') && css.includes('.ai-btn'))
  // 0.12.0: بنفش (#7c3aed / --ai-accent) در پالت تازه هیچ‌جا نیست —
  // اکسنت دستیار هم جیگری شده است (D-UX3 الف).
  const purpleLines = css.split('}').filter((rule) => rule.includes('#7c3aed') || rule.includes('--ai-accent'))
  check('G3 bundle: no purple (#7c3aed / --ai-accent) anywhere in the new palette',
    purpleLines.length === 0,
    JSON.stringify(purpleLines.map((r) => r.slice(0, 80))))
  check('G3 bundle: no purple token in non-assistant view sources (HomeView uses .ai-card/.ai-btn, not the token)',
    !homeSrc.includes('#7C3AED') && !homeSrc.includes('#7c3aed') && !homeSrc.includes('btn-ai') &&
    !homeSrc.includes('var(--ai-accent)'))
  // H1: two-tap close (no native confirm), compact hero, glass form
  // card, soft assistant border, two-line titles.
  check('H1 bundle: no native confirm() call left in HomeView',
    !homeSrc.includes('confirm('), 'confirm( still in HomeView')
  check('H1 bundle: hero is compact (h-44, not h-60)',
    homeSrc.includes('relative h-44') && !homeSrc.includes('relative h-60'))
  check('H1 bundle: project creation form card is glass (no bg-base-200)',
    homeSrc.includes('<div class="card glass-card">') && !homeSrc.includes('bg-base-200'))
  check('H1 bundle: assistant card border is soft jigari 0.25 (minified as #7f1d1d40)',
    css.includes('.ai-card{border:1px solid #7f1d1d40}'))
  check('H2 bundle: quick-task input on the my-tasks card',
    homeSrc.includes('placeholder="کار تازه برای من"'))
  check('H2 bundle: new-doc input on the recent-docs card',
    homeSrc.includes('placeholder="نام سند تازه در این پروژه"'))
  check('H2 bundle: favorites card exists (data-home-card="favorites")',
    homeSrc.includes('data-home-card="favorites"'))
  check('H2 bundle: pulse docs select reads custom_fields (starred)',
    dataSrc.includes('custom_fields'))
  check('H3 bundle: today card exists (data-home-card="today")',
    homeSrc.includes('data-home-card="today"'))
  check('H3 bundle: recent-rooms card exists (data-home-card="recent-rooms")',
    homeSrc.includes('data-home-card="recent-rooms"'))
  check('H3 bundle: recent-rooms loader queries messages newest-first, limit 100',
    dataSrc.includes('loadRecentRooms') &&
    dataSrc.includes(".from('messages')") &&
    dataSrc.includes('.limit(100)'))
  check('H1 bundle: long titles clamp to two lines (line-clamp-2)',
    homeSrc.includes('line-clamp-2'))

  // memberName() in the app: Zahra's seeded row is 'زهرا'; my row is
  // upserted from the fake session (no user_metadata), so its name is
  // the email local part 'yasin'. The mount nameOf must match that.
  const nameOf = (id) => (id === MEMBER_ID ? 'yasin' : id === MEMBER2_ID ? 'زهرا' : 'عضو')

  // ---- mount 1: full data ----
  const db1 = makeDb()
  seedG3(db1)
  const stub1 = makeStub(db1)
  const m1 = await mountApp({ html, js }, stub1, '#/')
  const w1 = m1.w
  allErrors.push(...m1.errors)
  await waitFor(w1, () => w1.document.querySelector('[data-pulse-number="messages"]'), 10000, 'pulse numbers')
  await waitFor(w1, () => w1.document.body.textContent.includes('پروژهٔ پروب G3'), 10000, 'project loaded')

  // Expected numbers from the SAME pure function the app uses, over the
  // same seed rows — the mount proves wiring, the unit tests prove the
  // function itself.
  const expected = computeTeamPulse(
    { messages: db1.messages, tasks: db1.tasks, docs: db1.docs, files: db1.files },
    new Date()
  )
  const num = (key) => {
    const el = w1.document.querySelector('[data-pulse-number="' + key + '"]')
    return el ? norm(el.textContent) : null
  }
  check('G3 mount: pulse messages today matches computeTeamPulse',
    num('messages') === faNum(expected.todayMessages), num('messages') + ' vs ' + faNum(expected.todayMessages))
  check('G3 mount: pulse done this week matches computeTeamPulse',
    num('done-week') === faNum(expected.doneThisWeek), num('done-week'))
  check('G3 mount: pulse active docs matches computeTeamPulse',
    num('docs') === faNum(expected.activeDocs), num('docs'))
  check('G3 mount: pulse new files matches computeTeamPulse',
    num('files') === faNum(expected.newFiles), num('files'))

  // Chart: SVG + 7-point series + text-alternative table + % rules.
  const chartSvg = w1.document.querySelector('svg[data-pulse-chart]')
  check('G3 mount: hand-made 7-day SVG line chart renders', !!chartSvg)
  if (chartSvg) {
    const msgs = chartSvg.querySelector('[data-pulse-series="messages"]')
    const done = chartSvg.querySelector('[data-pulse-series="done"]')
    check('G3 mount: messages series has 7 points',
      !!msgs && msgs.getAttribute('points').trim().split(/\s+/).length === 7, msgs?.getAttribute('points'))
    check('G3 mount: done series has 7 points',
      !!done && done.getAttribute('points').trim().split(/\s+/).length === 7, done?.getAttribute('points'))
    check('H1 mount: chart gridlines render (3 lines) with a value label for the max',
      chartSvg.querySelectorAll('line').length === 3 &&
      [...chartSvg.querySelectorAll('text')].some((t) => norm(t.textContent) === '۵'),
      'lines=' + chartSvg.querySelectorAll('line').length)
  }
  const chartRows = [...w1.document.querySelectorAll('[data-pulse-chart-table] tbody tr')]
  check('G3 mount: text-alternative table has 7 rows with the same daily numbers',
    chartRows.length === 7 &&
    chartRows.every((tr, i) => {
      const tds = tr.querySelectorAll('td')
      return tds.length === 3 &&
        norm(tds[1].textContent) === faNum(expected.days[i].messages) &&
        norm(tds[2].textContent) === faNum(expected.days[i].done)
    }), JSON.stringify(chartRows.map((tr) => norm(tr.textContent))))
  if (expected.changeMessages !== null) {
    const el = w1.document.querySelector('[data-pulse-change-messages]')
    check('G3 mount: weekly change % for messages is shown (prev sum > 0)',
      !!el && norm(el.textContent).includes(faNum(expected.changeMessages)), el && norm(el.textContent))
  } else {
    check('G3 mount: no messages % element when prev sum is 0',
      !w1.document.querySelector('[data-pulse-change-messages]'))
  }
  if (expected.changeDone !== null) {
    const el = w1.document.querySelector('[data-pulse-change-done]')
    check('G3 mount: weekly change % for done tasks is shown (prev sum > 0)',
      !!el && norm(el.textContent).includes(faNum(expected.changeDone)), el && norm(el.textContent))
  } else {
    check('G3 mount: no done % element when prev sum is 0',
      !w1.document.querySelector('[data-pulse-change-done]'))
  }

  // Bento: DOM order is the mobile reading order; 13 home sections.
  const cardOrder = [...w1.document.querySelectorAll('[data-home-card]')].map((el) => el.dataset.homeCard)
  check('H3 mount: 13 home sections in mobile reading order (today after greeting, recent-rooms after activity)',
    JSON.stringify(cardOrder) === JSON.stringify(['greeting', 'today', 'mentions', 'my-tasks', 'progress', 'recent-docs', 'activity', 'recent-rooms', 'favorites', 'reminders', 'files', 'assistant', 'pulse']),
    JSON.stringify(cardOrder))
  const cardCls = (id) => {
    const el = w1.document.querySelector('[data-home-card="' + id + '"]')
    return el ? [...el.classList] : []
  }
  check('H3 mount: today card is 1/5 on desktop',
    cardCls('today').includes('lg:col-start-1') && cardCls('today').includes('lg:col-span-5'))
  check('G3 mount: mentions card is 10/3 on desktop',
    cardCls('mentions').includes('lg:col-start-10') && cardCls('mentions').includes('lg:col-span-3'))
  check('H3 mount: my-tasks card is 6/4 on desktop',
    cardCls('my-tasks').includes('lg:col-start-6') && cardCls('my-tasks').includes('lg:col-span-4'))
  check('H3 mount: progress card is 1/4 on desktop',
    cardCls('progress').includes('lg:col-start-1') && cardCls('progress').includes('lg:col-span-4'))
  check('G3 mount: recent-docs card is 1/7 on desktop',
    cardCls('recent-docs').includes('lg:col-start-1') && cardCls('recent-docs').includes('lg:col-span-7'))
  check('G3 mount: activity card is 8/5 on desktop',
    cardCls('activity').includes('lg:col-start-8') && cardCls('activity').includes('lg:col-span-5'))
  check('G3 mount: reminders card is 1/4 on desktop',
    cardCls('reminders').includes('lg:col-start-1') && cardCls('reminders').includes('lg:col-span-4'))
  check('G3 mount: files card is 5/4 on desktop',
    cardCls('files').includes('lg:col-start-5') && cardCls('files').includes('lg:col-span-4'))
  check('G3 mount: assistant card is 9/4 on desktop',
    cardCls('assistant').includes('lg:col-start-9') && cardCls('assistant').includes('lg:col-span-4'))
  check('H3 mount: recent-rooms card is 5/4 on desktop',
    cardCls('recent-rooms').includes('lg:col-start-5') && cardCls('recent-rooms').includes('lg:col-span-4'))
  check('H3 mount: favorites card is 9/4 on desktop',
    cardCls('favorites').includes('lg:col-start-9') && cardCls('favorites').includes('lg:col-span-4'))
  check('G3 mount: pulse card spans all 12 columns on desktop',
    cardCls('pulse').includes('lg:col-span-12'))

  // Mentions card (from the same notification pointers as the bell).
  // loadNotifications() runs async in onMount — wait for its rows.
  await waitFor(w1, () => w1.document.querySelector('[data-mentions-count]'), 10000, 'mentions count')
  const mentionCount = w1.document.querySelector('[data-mentions-count]')
  check('G3 mount: mentions card shows exactly 2 unread mentions',
    !!mentionCount && norm(mentionCount.textContent) === '۲', mentionCount && norm(mentionCount.textContent))
  const mentionLink = w1.document.querySelector('[data-home-card="mentions"] a')
  check('G3 mount: mentions link points at the room of the first mention',
    !!mentionLink && mentionLink.getAttribute('href') === '#/room/' + ROOM_ID,
    mentionLink && mentionLink.getAttribute('href'))

  // H3-1: today timeline — r1 18:00, then the three 23:59 tasks in
  // pulse order (کار ۱۰، کار ۱، کار ۲). t1 is todo in the G3 seed.
  await waitFor(w1, () => w1.document.querySelectorAll('[data-today-list] li').length === 4, 10000, 'today timeline rows')
  const todayRows = [...w1.document.querySelectorAll('[data-today-list] li')]
  check('H3 mount: today timeline shows 4 items, by time (یادآوری ۱۸:۰۰، then ۳ tasks at ۲۳:۵۹)',
    todayRows.length === 4 &&
    norm(todayRows[0].textContent).includes('یادآوری پروب') &&
    norm(todayRows[0].textContent).includes('۱۸:۰۰') &&
    norm(todayRows[0].textContent).includes('یادآوری') &&
    norm(todayRows[1].textContent).includes('کار ۱۰') &&
    norm(todayRows[1].textContent).includes('۲۳:۵۹') &&
    norm(todayRows[2].textContent).includes('کار ۱') &&
    norm(todayRows[3].textContent).includes('کار ۲'),
    JSON.stringify(todayRows.map((li) => norm(li.textContent))))

  // My tasks: max 4, nearest due first; checkbox toggles done and the
  // progress ring moves.
  const myTaskRows = [...w1.document.querySelectorAll('[data-my-tasks-list] li')]
  check('G3 mount: my-tasks shows max 4 rows', myTaskRows.length === 4, String(myTaskRows.length))
  const myTitles = myTaskRows.map((li) => li.querySelector('span.flex-1')?.textContent.trim())
  check('G3 mount: my-tasks shows my nearest unfinished tasks (کار ۱۰، کار ۱، کار ۲، کار ۳)',
    JSON.stringify(myTitles) === JSON.stringify(['کار ۱۰', 'کار ۱', 'کار ۲', 'کار ۳']), JSON.stringify(myTitles))
  const progBefore = norm(w1.document.querySelector('[data-progress-count]')?.textContent)
  check('G3 mount: progress starts at ۳ از ۹ (P1: 5 todo + 1 doing + 3 done)',
    progBefore.includes('۳') && progBefore.includes('۹'), progBefore)
  // H1-4: the progress selector defaults to the current project (P1),
  // not to a project chosen by list order.
  const progSelect0 = w1.document.querySelector('[data-home-card="progress"] select')
  check('H1 mount: progress defaults to the current project (P1)',
    !!progSelect0 && progSelect0.value === PROJECT_ID, progSelect0 && progSelect0.value)
  const t1Row = myTaskRows.find((li) => li.querySelector('span.flex-1')?.textContent.trim() === 'کار ۱')
  const t1Box = t1Row.querySelector('input[type="checkbox"]')
  check('G3 mount: کار ۱ starts unchecked', !!t1Box && !t1Box.checked)
  t1Box.click()
  await waitFor(w1, () => {
    const t = norm(w1.document.querySelector('[data-progress-count]')?.textContent || '')
    return t.includes('۴') && t.includes('۹')
  }, 10000, 'progress becomes ۴ از ۹ after checking کار ۱')
  check('G3 mount: checking کار ۱ moves the progress ring to ۴ از ۹', true)
  const t1DbRow = db1.tasks.find((t) => t.id === 't1')
  check('G3 mount: کار ۱ row is done in the DB after the toggle',
    t1DbRow.status === 'done' && !!t1DbRow.completed_at, JSON.stringify(t1DbRow))
  const myTitlesAfter = [...w1.document.querySelectorAll('[data-my-tasks-list] li')]
    .map((li) => li.querySelector('span.flex-1')?.textContent.trim())
  check('G3 mount: کار ۱ leaves the visible 4 once done (done tasks sort last)',
    !myTitlesAfter.includes('کار ۱') && JSON.stringify(myTitlesAfter) === JSON.stringify(['کار ۱۰', 'کار ۲', 'کار ۳', 'کار ۵']),
    JSON.stringify(myTitlesAfter))

  // H2-1: quick task — creates a task for me in the current project
  // and the progress ring moves from ۴ از ۹ to ۴ از ۱۰ (کار ۱ was
  // toggled done just above).
  const quickInput = w1.document.querySelector('input[placeholder="کار تازه برای من"]')
  check('H2 mount: quick-task input renders on the my-tasks card', !!quickInput)
  setInput(w1, quickInput, 'کار سریع پروب')
  // The button enables only once the title binding has flushed.
  await waitFor(w1, () => {
    const b = [...w1.document.querySelectorAll('[data-home-card="my-tasks"] button')].find((x) => x.textContent.trim() === 'ساختن')
    return b && !b.disabled
  }, 10000, 'quick-task button enabled')
  clickButton(w1, w1.document.querySelector('[data-home-card="my-tasks"]'), 'ساختن')
  await waitFor(w1, () => db1.tasks.length === 11, 10000, 'quick task row created')
  const qt = db1.tasks.find((t) => t.title === 'کار سریع پروب')
  check('H2 mount: quick task is mine, in the current project, todo',
    !!qt && qt.assignee_id === MEMBER_ID && qt.project_id === PROJECT_ID && qt.status === 'todo',
    JSON.stringify(qt))
  await waitFor(w1, () => {
    const t = norm(w1.document.querySelector('[data-progress-count]')?.textContent || '')
    return t.includes('۴') && t.includes('۱۰')
  }, 10000, 'progress becomes ۴ از ۱۰ after the quick task')
  check('H2 mount: quick task moves the progress ring to ۴ از ۱۰', true)

  // Progress switcher: P2 has 1 todo task -> ۰ از ۱.
  const progSelect = w1.document.querySelector('[data-home-card="progress"] select')
  progSelect.value = PROJECT2_ID
  progSelect.dispatchEvent(new w1.Event('change', { bubbles: true }))
  await waitFor(w1, () => {
    const t = norm(w1.document.querySelector('[data-progress-count]')?.textContent || '')
    return t.includes('۰') && t.includes('۱')
  }, 10000, 'progress switches to P2: ۰ از ۱')
  check('G3 mount: project switcher moves progress to the empty project (۰ از ۱)', true)

  // Recent docs: newest edited first.
  const docRows = [...w1.document.querySelectorAll('[data-recent-docs-list] li')]
  check('G3 mount: recent docs shows 3 rows, newest first (سند خالی، سند تازه، سند قدیمی)',
    docRows.length === 3 &&
    norm(docRows[0].textContent).includes('سند خالی') &&
    norm(docRows[1].textContent).includes('سند تازه') &&
    norm(docRows[2].textContent).includes('سند قدیمی'),
    JSON.stringify(docRows.map((li) => norm(li.textContent))))
  check('H2 mount: recent-docs rows show the project name',
    norm(docRows[0].textContent).includes('پروژهٔ خالی') &&
    norm(docRows[1].textContent).includes('پروژهٔ پروب G3'),
    JSON.stringify(docRows.map((li) => norm(li.textContent))))

  // Recent activity: same rows as buildRecentActivity over the seed.
  const expectedAct = buildRecentActivity(
    { tasks: db1.tasks, docs: db1.docs, versions: db1.versions }, nameOf, new Date(), 5
  )
  const actRows = [...w1.document.querySelectorAll('[data-activity-list] li')]
  check('G3 mount: activity shows 5 merged events',
    actRows.length === 5, String(actRows.length))
  check('G3 mount: activity rows match buildRecentActivity (actor + text, newest first)',
    actRows.length === 5 && actRows.every((li, i) =>
      norm(li.textContent).includes(expectedAct[i].actor + ' ' + expectedAct[i].text)),
    JSON.stringify(actRows.map((li) => norm(li.textContent))) + ' vs ' +
    JSON.stringify(expectedAct.map((a) => a.actor + ' ' + a.text)))

  // Reminders: in-app list only, honest label, max 5.
  const remRows = [...w1.document.querySelectorAll('[data-reminders-list] li')]
  check('G3 mount: reminders list shows the seeded reminder',
    remRows.some((li) => norm(li.textContent).includes('یادآوری پروب')))
  check('G3 mount: reminders list has at most 5 rows', remRows.length <= 5, String(remRows.length))
  check('G3 mount: reminders card says in-app only, no push',
    norm(w1.document.querySelector('[data-home-card="reminders"]').textContent).includes('فقط درون‌اپی — پوش نمی‌فرستیم'))

  // Recent files: newest first, max 5.
  const fileRows = [...w1.document.querySelectorAll('[data-recent-files-list] li')]
  check('G3 mount: recent files shows 5 rows, newest first, فایل ۶ excluded',
    fileRows.length === 5 &&
    norm(fileRows[0].textContent).includes('فایل ۱') &&
    !w1.document.querySelector('[data-recent-files-list]').textContent.includes('فایل ۶'),
    JSON.stringify(fileRows.map((li) => norm(li.textContent))))

  // H2-3: favorites card shows the starred doc (سند تازه).
  const favRows = [...w1.document.querySelectorAll('[data-favorites-list] li')]
  check('H2 mount: favorites card shows the starred doc (سند تازه)',
    favRows.length === 1 && norm(favRows[0].textContent).includes('سند تازه'),
    JSON.stringify(favRows.map((li) => norm(li.textContent))))

  // H3-2: recent rooms — ROOM_ID with the newest message (m3, today
  // 11:00) and 2 unread mentions (n1, n2); ROOM2 has no messages and
  // is dropped.
  await waitFor(w1, () => w1.document.querySelectorAll('[data-recent-rooms-list] li').length === 1, 10000, 'recent rooms rows')
  const roomRows = [...w1.document.querySelectorAll('[data-recent-rooms-list] li')]
  check('H3 mount: recent rooms shows the room with messages (گفت‌وگو), newest message + time',
    roomRows.length === 1 &&
    norm(roomRows[0].textContent).includes('گفت‌وگو') &&
    norm(roomRows[0].textContent).includes('پیام m3') &&
    norm(roomRows[0].textContent).includes('۱۱:۰۰'),
    JSON.stringify(roomRows.map((li) => norm(li.textContent))))
  const roomBadge = roomRows[0].querySelector('.badge')
  check('H3 mount: recent rooms shows the unread mention badge (۲)',
    !!roomBadge && norm(roomBadge.textContent) === '۲', roomBadge && norm(roomBadge.textContent))
  const roomLink = roomRows[0].querySelector('a')
  check('H3 mount: recent room name links to the room',
    !!roomLink && roomLink.getAttribute('href') === '#/room/' + ROOM_ID,
    roomLink && roomLink.getAttribute('href'))

  // G3-7: presence only in the hero strip; no new Realtime channel.
  check('G3 mount: presence dots live only in the sidebar seats (not in cards)',
    [...w1.document.querySelectorAll('[data-home-card] .rounded-full')].length === 0)
  check('G3 mount: no new Realtime channel opened on the home page (0 WebSocket constructions)',
    m1.wsCreated() === 0, 'wsCreated=' + m1.wsCreated())
  check('G3 mount: no weather / Upgrade text anywhere on the home page',
    !w1.document.body.textContent.includes('آب‌وهوا') &&
    !w1.document.body.textContent.includes('Upgrade'))

  // Assistant card: the ONLY purple card; its button goes to #/assistant.
  const aiCard = w1.document.querySelector('[data-home-card="assistant"]')
  check('G3 mount: assistant card carries .ai-card (the only purple card)',
    !!aiCard && aiCard.classList.contains('ai-card'))
  check('G3 mount: assistant card has an .ai-btn button',
    !!aiCard && !!aiCard.querySelector('.ai-btn'))
  const otherPurple = [...w1.document.querySelectorAll('[data-home-card]')]
    .filter((el) => el !== aiCard && el.classList.contains('ai-card'))
  check('G3 mount: no other home card is purple', otherPurple.length === 0)
  const askBtn = aiCard.querySelector('.ai-btn')
  askBtn.click()
  await waitFor(w1, () => w1.location.hash === '#/assistant', 10000, 'assistant navigation')
  check('G3 mount: «بپرس» navigates to the assistant view', w1.location.hash === '#/assistant')

  // G3-4: mobile bottom nav (4 destinations) + G3-1 sidebar width.
  const navLinks = [...w1.document.querySelectorAll('[data-bottom-nav] a')].map((a) => a.getAttribute('href'))
  check('G3 mount: mobile bottom nav has exactly 4 destinations (خانه، اتاق‌ها، کارها، اعضا)',
    JSON.stringify(navLinks) === JSON.stringify(['#/', '#/rooms', '#/tasks', '#/members']),
    JSON.stringify(navLinks))
  const aside = w1.document.querySelector('aside[data-sidebar]')
  check('G3 mount: sidebar is w-[72px] at md and lg:w-[264px]',
    !!aside && aside.classList.contains('w-[72px]') && aside.classList.contains('lg:w-[264px]'))

  allErrors.push(...m1.errors)
  m1.dom.window.close()

  // ---- mount 1b: H2-2 new doc from the recent-docs card ----
  const db1b = makeDb()
  seedG3(db1b)
  const stub1b = makeStub(db1b)
  const m1b = await mountApp({ html, js }, stub1b, '#/')
  const w1b = m1b.w
  allErrors.push(...m1b.errors)
  // The sidebar has its own doc-creation input with a similar
  // placeholder, so the card's input is queried scoped to the card.
  const newDocSel = '[data-home-card="recent-docs"] input[placeholder="نام سند تازه در این پروژه"]'
  await waitFor(w1b, () => w1b.document.querySelector(newDocSel), 10000, 'new-doc input')
  // Let the app settle (pulse loaded) before typing: typing into the
  // input before Svelte's bind:value listener attaches loses the event
  // and the button never enables.
  await waitFor(w1b, () => w1b.document.querySelector('[data-pulse-number="messages"]'), 10000, 'pulse numbers (app settled)')
  const newDocInput = w1b.document.querySelector(newDocSel)
  check('H2 mount: new-doc input renders on the recent-docs card', !!newDocInput)
  setInput(w1b, newDocInput, 'سند پروب خانه')
  // The button enables only once the workspace load has set
  // currentProjectId AND the title binding has flushed — wait for
  // that directly instead of guessing a sleep.
  await waitFor(w1b, () => {
    const b = [...w1b.document.querySelectorAll('[data-home-card="recent-docs"] button')].find((x) => x.textContent.trim() === 'ساختن')
    return b && !b.disabled
  }, 10000, 'new-doc button enabled')
  clickButton(w1b, w1b.document.querySelector('[data-home-card="recent-docs"]'), 'ساختن')
  await waitFor(w1b, () => w1b.location.hash.startsWith('#/doc/'), 10000, 'navigate to the new doc')
  const nd = db1b.docs.find((d) => d.title === 'سند پروب خانه')
  check('H2 mount: new doc row created in the current project',
    !!nd && nd.project_id === PROJECT_ID, JSON.stringify(nd))
  check('H2 mount: new doc navigation lands on the new doc id',
    w1b.location.hash === '#/doc/' + (nd && nd.id), w1b.location.hash)
  allErrors.push(...m1b.errors)
  m1b.dom.window.close()

  // ---- mount 2: empty workspace ----
  const db2 = makeDb()
  const stub2 = makeStub(db2)
  const m2 = await mountApp({ html, js }, stub2, '#/')
  const w2 = m2.w
  allErrors.push(...m2.errors)
  await waitFor(w2, () => w2.document.querySelector('[data-pulse-number="messages"]'), 10000, 'empty pulse numbers')
  await waitFor(w2, () => w2.document.body.textContent.includes('منشنی نیست'), 10000, 'empty mentions state')
  await waitFor(w2, () => w2.document.body.textContent.includes('هنوز پروژه‌ای نیست'), 10000, 'empty progress state')
  check('G3 empty: all four pulse numbers are ۰',
    ['messages', 'done-week', 'docs', 'files'].every((k) => norm(w2.document.querySelector('[data-pulse-number="' + k + '"]').textContent) === '۰'))
  check('G3 empty: chart says «هنوز داده‌ای نیست» and no SVG renders',
    norm(w2.document.querySelector('[data-home-card="pulse"]').textContent).includes('هنوز داده‌ای نیست') &&
    !w2.document.querySelector('svg[data-pulse-chart]'))
  check('G3 empty: no weekly-change % element exists at all',
    !w2.document.querySelector('[data-pulse-change-messages]') &&
    !w2.document.querySelector('[data-pulse-change-done]'))
  check('G3 empty: every card shows its empty state',
    ['منشنی نیست', 'کاری به تو سپرده نشده', 'هنوز پروژه‌ای نیست', 'هنوز سندی نیست',
     'سندی ستاره‌دار نیست', 'هنوز فعالیتی نیست', 'یادآوری‌ای نیست', 'هنوز فایلی نیست',
     'برای امروز چیزی نیست', 'هنوز پیامی نیست']
      .every((t) => w2.document.body.textContent.includes(t)))
  allErrors.push(...m2.errors)
  m2.dom.window.close()

  // ---- mount 3: fresh workspace (no previous-week data) ----
  const db3 = makeDb()
  seedFresh(db3)
  const stub3 = makeStub(db3)
  const m3 = await mountApp({ html, js }, stub3, '#/')
  const w3 = m3.w
  allErrors.push(...m3.errors)
  await waitFor(w3, () => w3.document.querySelector('[data-pulse-number="messages"]'), 10000, 'fresh pulse numbers')
  check('G3 fresh: chart renders with current-week data',
    !!w3.document.querySelector('svg[data-pulse-chart]'))
  check('G3 fresh: no % element when the previous 7-day sum is 0',
    !w3.document.querySelector('[data-pulse-change-messages]') &&
    !w3.document.querySelector('[data-pulse-change-done]'))
  check('G3 fresh: pulse numbers are the real counts (۱ پیام، ۱ کار)',
    norm(w3.document.querySelector('[data-pulse-number="messages"]').textContent) === '۱' &&
    norm(w3.document.querySelector('[data-pulse-number="done-week"]').textContent) === '۱')
  allErrors.push(...m3.errors)
  m3.dom.window.close()

  // ---- mount 4: loading state (slow pulse queries) ----
  const db4 = makeDb()
  seedG3(db4)
  const stub4 = makeStub(db4, { slowPulse: true })
  const m4 = await mountApp({ html, js }, stub4, '#/')
  const w4 = m4.w
  allErrors.push(...m4.errors)
  await waitFor(w4, () => w4.document.body.textContent.includes('در حال بارگذاری نبض تیم…'), 10000, 'pulse loading state')
  check('G3 loading: loading state shows while pulse queries are slow', true)
  await waitFor(w4, () => {
    const el = w4.document.querySelector('[data-pulse-number="messages"]')
    return el && norm(el.textContent) === '۳'
  }, 10000, 'pulse numbers after slow load')
  check('G3 loading: numbers arrive after the slow load finishes', true)
  allErrors.push(...m4.errors)
  m4.dom.window.close()

  // ---- mount 5: error state + retry (failing pulse queries) ----
  const db5 = makeDb()
  seedG3(db5)
  const stub5 = makeStub(db5, { failPulse: true })
  const m5 = await mountApp({ html, js }, stub5, '#/')
  const w5 = m5.w
  allErrors.push(...m5.errors)
  await waitFor(w5, () => w5.document.body.textContent.includes('نبض تیم بارگذاری نشد'), 10000, 'pulse error state')
  check('G3 error: failing pulse queries show a visible error state', true)
  check('H3 error: today card shows its error state when the pulse fails',
    norm(w5.document.querySelector('[data-home-card="today"]').textContent).includes('امروز بارگذاری نشد'))
  await waitFor(w5, () => w5.document.body.textContent.includes('اتاق‌های اخیر بارگذاری نشد'), 10000, 'recent rooms error state')
  check('H3 error: failing pulse queries show the recent-rooms error state (mount survives)', true)
  check('G3 error: retry button is present',
    [...w5.document.querySelectorAll('[data-home-card="pulse"] button')].some((b) => norm(b.textContent) === 'تلاش دوباره'))
  stub5.opts.failPulse = false
  clickButton(w5, w5.document.querySelector('[data-home-card="pulse"]'), 'تلاش دوباره')
  await waitFor(w5, () => {
    const el = w5.document.querySelector('[data-pulse-number="messages"]')
    return el && norm(el.textContent) === '۳'
  }, 10000, 'pulse numbers after retry')
  check('G3 error: retry recovers the numbers once the queries succeed', true)
  allErrors.push(...m5.errors)
  m5.dom.window.close()

  // ---- JS errors ----
  const realErrors = allErrors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors across all mounts', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
  if (allErrors.length > 0) console.log('note: filtered Realtime/WebSocket noise:', allErrors.length, 'entries')

  console.log(failures === 0 ? 'ALL G3 PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('G3 PROBE FAILED:', e.message)
  console.log('window errors:', JSON.stringify(allErrors, null, 2))
  process.exit(1)
})
