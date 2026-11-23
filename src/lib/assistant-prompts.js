// «دستیار میوز» — رجیستری دستورها (پکیج A/B + جارویس ای آی فاز ۱).
//
// یک ورودی به‌ازای هر اکشن؛ ریل چیپ، کارت خانه و چیپ‌های خانه همه از همین
// فایل رندر می‌شوند — پس «۳۰ دستور» دیگر شمارش کارت‌های هاردکد نیست.
// شکل ورودی: id، title_fa، group، trigger، output، fallback،
// needsConfirm، maxTokens — به‌علاوهٔ n (شمارهٔ فهرست ۱۰۰تایی، برای
// چیپ و پروب)، existing (کلید بخش قدیمی در AssistantView)، chip
// (آیا در ریل چیپ می‌آید) و ai (آیا مدل برایش صدا زده می‌شود).
//
// فاز ۱ (جارویس ای آی): متن پرامپت سیستم و ساخت کانتکست از رجیستری
// به تابع لبه رفت (supabase/functions/ai-assistant/prompts.js و
// retrieve.js) — کلاینت فقط { action, params, history } می‌فرستد.
// ورودی‌های رجیستری دیگر system / userTemplate / buildContext /
// buildPrompt ندارند؛ ۷ پرامپت فارسی §۳ـ۴ حالا در تابع زندگی می‌کنند.
//
// فیلترهای تکراری پارامتری‌اند، نه تابع‌های جدا: #13/#15/#23 سه گونهٔ
// اکشن list-messages و #58/#59/#63/#64 چهار گونهٔ list-tasks و #71/#72
// دو گونهٔ list-reminders‌اند — هر گونه ورودیِ خودش را در رجیستری دارد
// (پس ریل هنوز ۳۰ چیپ دارد) ولی همه یک loader مشترک را صدا می‌زنند.
//
// پرامپت‌های suggest-task-* و deadline-guardian در رجیستری‌اند ولی در
// پکیج B مدل برایشان صدا زده نمی‌شود (ai: false، aiFrom: 'C') —
// چت→کار ساخت‌یافته و استدلال سررسید مال پکیج C است؛ تا آن‌وقت همان
// قانون‌محورِ امروز کار می‌کند. open-chat چیپ ندارد (chip: false) —
// از ورودی خانه و از دکمهٔ بالای پنل می‌رسد؛ ریل ۳۰ چیپ می‌ماند.
//
// قوانین سفت (گزارش §۳ـ۵): R1 هیچ جواب ساخته‌شده‌ای (found:false)،
// R2 هیچ نوشته‌ای بدون تأیید یک‌تپی، R3 هرگز به‌جای کسی، R4 تاریخ در
// کد نه در مدل، R5 محتوای پیام/سند داده است نه دستور، R6 فارسی و
// کوتاه، R7 fallback همیشه استخراجی، R8 نوشتهٔ بی‌صدا تپ‌دار،
// R9 ورودی خانه درست می‌شود.
import {
  summarizeRoom,
  summarizeDoc,
  suggestTasksFromDoc,
  suggestTasksFromChat,
  loadDeadlineGuardian,
  askWorkspace,
  projectStatus,
  projectDeadline,
  suggestCloseProject,
  listTodayMessages,
  listUnansweredMessages,
  listOpenThreads,
  loadMyMentions,
  loadUnreadNotifications,
  listStaleDocs,
  listOpenComments,
  listDocVersions,
  listFreshFiles,
  listUnattachedFiles,
  listMyTodayTasks,
  listOverdueTasks,
  listUndatedTasks,
  listUnassignedTasks,
  listTodayReminders,
  listOverdueReminders,
  searchDocsText,
  loadTeamPulseToday,
  loadDailyReport,
  lastActivity,
  listDocTemplates
} from './assistant.js'

// ---------- loaderهای پارامتری (فیلترهای تکراری، یک پیاده‌سازی) ----------

function loadMessagesVariant(variant, { projectId }) {
  if (variant === 'today') return listTodayMessages()
  if (variant === 'unanswered') return listUnansweredMessages(projectId)
  return listOpenThreads(projectId)
}

function loadTasksVariant(variant, { projectId }) {
  if (variant === 'today') return listMyTodayTasks(projectId)
  if (variant === 'overdue') return listOverdueTasks(projectId)
  if (variant === 'undated') return listUndatedTasks(projectId)
  return listUnassignedTasks(projectId)
}

function loadRemindersVariant(variant) {
  if (variant === 'today') return listTodayReminders()
  return listOverdueReminders()
}

// ---------- رجیستری ----------

export const ASSISTANT_ACTIONS = [
  // --- خلاصه (خانوادهٔ خلاصه) ---
  {
    id: 'summarize-room',
    n: 11,
    title_fa: 'خلاصهٔ اتاق',
    group: 'ب — اتاق‌ها و پیام‌ها',
    trigger: 'chip:11 | home:summary',
    existing: 'room',
    chip: true,
    ai: true,
    output: { type: 'json', schema: { points: [{ text: 'string', source_ids: ['string'] }] } },
    fallback: 'extractRoomSummary',
    needsConfirm: false,
    maxTokens: 400,
    runFallback: (inputs) => summarizeRoom(inputs.roomId)
  },
  {
    id: 'summarize-doc',
    n: 31,
    title_fa: 'خلاصهٔ سند',
    group: 'د — سندها',
    trigger: 'chip:31',
    existing: 'doc',
    chip: true,
    ai: true,
    output: { type: 'json', schema: { points: [{ text: 'string', paragraph: 'number' }] } },
    fallback: 'extractDocSummary',
    needsConfirm: false,
    maxTokens: 400,
    runFallback: (inputs) => summarizeDoc(inputs.docId)
  },
  // --- پیشنهاد کار (قانون‌محور در B؛ پرامپت برای C آماده است) ---
  {
    id: 'suggest-task-from-chat',
    n: 21,
    title_fa: 'پیشنهاد کار از چت',
    group: 'ب — اتاق‌ها و پیام‌ها',
    trigger: 'chip:21',
    existing: 'chat-sug',
    chip: true,
    ai: false,
    aiFrom: 'C',
    output: { type: 'json', schema: [{ title: 'string', description: 'string', assignee: 'string|null', due_hint: 'string|null' }] },
    fallback: 'extractChatTaskSuggestions',
    needsConfirm: true,
    maxTokens: 400,
    load: (inputs) => suggestTasksFromChat(inputs.roomId)
  },
  {
    id: 'suggest-task-from-doc',
    n: 36,
    title_fa: 'پیشنهاد کار از سند',
    group: 'د — سندها',
    trigger: 'chip:36',
    existing: 'doc-sug',
    chip: true,
    ai: false,
    aiFrom: 'C',
    output: { type: 'json', schema: [{ title: 'string', description: 'string', assignee: 'string|null', due_hint: 'string|null' }] },
    fallback: 'extractDocTaskSuggestions',
    needsConfirm: true,
    maxTokens: 400,
    load: (inputs) => suggestTasksFromDoc(inputs.docId)
  },
  // --- نگهبان / سررسید (همیشه قانون‌محور؛ استدلال سررسید مال C است) ---
  {
    id: 'deadline-guardian',
    n: 57,
    title_fa: 'نگهبان مهلت‌ها',
    group: 'ز — کارها و برنامه‌ریز',
    trigger: 'chip:57 | home:guardian',
    existing: 'guardian',
    chip: true,
    ai: false,
    aiFrom: 'C',
    output: { type: 'json', schema: { buckets: { overdue: [{ task_id: 'string', reason: 'string' }], today: [], next48h: [] } } },
    fallback: 'computeDeadlineGuardian',
    needsConfirm: false,
    maxTokens: 400,
    load: (inputs) => loadDeadlineGuardian(inputs.projectId)
  },
  // --- سؤال و جست‌وجو ---
  {
    id: 'ask-workspace',
    n: 77,
    title_fa: 'سؤال دربارهٔ فضای کاری',
    group: 'ط — جست‌وجو و پرس‌وجو',
    trigger: 'chip:77 | home:ask',
    existing: 'ask',
    chip: true,
    ai: true,
    output: { type: 'json', schema: { answer: 'string', sources: [{ table: 'string', id: 'string' }] } },
    fallback: 'searchWorkspace',
    needsConfirm: false,
    maxTokens: 400,
    runFallback: (inputs) => askWorkspace(inputs.question)
  },
  {
    id: 'open-chat',
    n: null,
    title_fa: 'گفت‌وگو با میوز',
    group: 'ط — جست‌وجو و پرس‌وجو',
    trigger: 'home:question | panel:chat',
    existing: 'chat',
    chip: false,
    ai: true,
    output: { type: 'json', schema: { answer: 'string', sources: [{ table: 'string', id: 'string' }] } },
    fallback: 'searchWorkspace',
    needsConfirm: false,
    maxTokens: 400,
    runFallback: (inputs) => askWorkspace(inputs.message)
  },
  // --- سلامت پروژه (G6) ---
  {
    id: 'project-status', n: 1, title_fa: 'وضعیت پروژه', group: 'الف — پروژه‌ها',
    trigger: 'chip:1', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'computeProjectReview', needsConfirm: false, maxTokens: 0,
    load: (inputs) => projectStatus(inputs.projectId)
  },
  {
    id: 'project-deadline', n: 3, title_fa: 'مهلت پروژه', group: 'الف — پروژه‌ها',
    trigger: 'chip:3', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'projectDeadlineInfo', needsConfirm: false, maxTokens: 0,
    load: (inputs) => projectDeadline(inputs.projectId)
  },
  {
    id: 'suggest-close-project', n: 8, title_fa: 'پیشنهاد بستن پروژه', group: 'الف — پروژه‌ها',
    trigger: 'chip:8', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'suggestProjectClose', needsConfirm: true, maxTokens: 0,
    load: (inputs) => suggestCloseProject(inputs.projectId)
  },
  {
    id: 'list-messages-today', n: 13, title_fa: 'پیام‌های امروز', group: 'ب — اتاق‌ها و پیام‌ها',
    trigger: 'chip:13 | home:today', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'todayMessages', needsConfirm: false, maxTokens: 0,
    load: (inputs) => loadMessagesVariant('today', inputs)
  },
  {
    id: 'list-messages-unanswered', n: 15, title_fa: 'پیام‌های بی‌پاسخ', group: 'ب — اتاق‌ها و پیام‌ها',
    trigger: 'chip:15', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'unansweredMessages', needsConfirm: false, maxTokens: 0,
    load: (inputs) => loadMessagesVariant('unanswered', inputs)
  },
  {
    id: 'list-messages-threads', n: 23, title_fa: 'تردهای باز', group: 'ج — ترد، منشن، اعلان',
    trigger: 'chip:23', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'openThreads', needsConfirm: false, maxTokens: 0,
    load: (inputs) => loadMessagesVariant('threads', inputs)
  },
  {
    id: 'list-mentions', n: 25, title_fa: 'منشن‌های من', group: 'ج — ترد، منشن، اعلان',
    trigger: 'chip:25', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'mentionsFirst', needsConfirm: false, maxTokens: 0,
    load: () => loadMyMentions()
  },
  {
    id: 'list-unread', n: 27, title_fa: 'اعلان‌های خوانده‌نشده', group: 'ج — ترد، منشن، اعلان',
    trigger: 'chip:27', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'groupNotificationsByType', needsConfirm: false, maxTokens: 0,
    load: () => loadUnreadNotifications()
  },
  {
    id: 'list-stale-docs', n: 33, title_fa: 'سندهای بدون تغییر', group: 'د — سندها',
    trigger: 'chip:33', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'staleDocs', needsConfirm: false, maxTokens: 0,
    load: (inputs) => listStaleDocs(inputs.projectId)
  },
  {
    id: 'list-open-comments', n: 41, title_fa: 'نظرهای باز یک سند', group: 'ه — نظرها و نسخه‌ها',
    trigger: 'chip:41', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'openComments', needsConfirm: false, maxTokens: 0,
    load: (inputs) => listOpenComments(inputs.docId)
  },
  {
    id: 'list-versions', n: 45, title_fa: 'نسخه‌های یک سند', group: 'ه — نظرها و نسخه‌ها',
    trigger: 'chip:45', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'listVersions', needsConfirm: false, maxTokens: 0,
    load: (inputs) => listDocVersions(inputs.docId)
  },
  {
    id: 'list-fresh-files', n: 49, title_fa: 'فایل‌های تازه', group: 'و — فایل‌ها',
    trigger: 'chip:49', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'freshFiles', needsConfirm: false, maxTokens: 0,
    load: (inputs) => listFreshFiles(inputs.projectId)
  },
  {
    id: 'list-unattached-files', n: 54, title_fa: 'فایل‌های بی‌وصل', group: 'و — فایل‌ها',
    trigger: 'chip:54', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'unattachedFiles', needsConfirm: false, maxTokens: 0,
    load: (inputs) => listUnattachedFiles(inputs.projectId)
  },
  {
    id: 'list-tasks-today', n: 58, title_fa: 'کارهای امروز من', group: 'ز — کارها و برنامه‌ریز',
    trigger: 'chip:58', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'myTodayTasks', needsConfirm: false, maxTokens: 0,
    load: (inputs) => loadTasksVariant('today', inputs)
  },
  {
    id: 'list-tasks-overdue', n: 59, title_fa: 'کارهای عقب‌مانده', group: 'ز — کارها و برنامه‌ریز',
    trigger: 'chip:59', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'overdueTasks', needsConfirm: false, maxTokens: 0,
    load: (inputs) => loadTasksVariant('overdue', inputs)
  },
  {
    id: 'list-tasks-undated', n: 63, title_fa: 'کارهای بدون سررسید', group: 'ز — کارها و برنامه‌ریز',
    trigger: 'chip:63', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'undatedTasks', needsConfirm: false, maxTokens: 0,
    load: (inputs) => loadTasksVariant('undated', inputs)
  },
  {
    id: 'list-tasks-unassigned', n: 64, title_fa: 'کارهای بدون مسئول', group: 'ز — کارها و برنامه‌ریز',
    trigger: 'chip:64', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'unassignedTasks', needsConfirm: false, maxTokens: 0,
    load: (inputs) => loadTasksVariant('unassigned', inputs)
  },
  {
    id: 'list-reminders-today', n: 71, title_fa: 'یادآوری‌های امروز من', group: 'ح — یادآوری‌ها',
    trigger: 'chip:71', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'todayReminders', needsConfirm: false, maxTokens: 0,
    load: () => loadRemindersVariant('today')
  },
  {
    id: 'list-reminders-overdue', n: 72, title_fa: 'یادآوری‌های عقب‌مانده', group: 'ح — یادآوری‌ها',
    trigger: 'chip:72', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'overdueReminders', needsConfirm: false, maxTokens: 0,
    load: () => loadRemindersVariant('overdue')
  },
  {
    id: 'search-doc-text', n: 84, title_fa: 'جست‌وجو در متن سندها', group: 'ط — جست‌وجو و پرس‌وجو',
    trigger: 'chip:84', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'searchDocLines', needsConfirm: false, maxTokens: 0,
    load: (inputs) => searchDocsText(inputs.projectId, inputs.word)
  },
  {
    id: 'team-pulse', n: 85, title_fa: 'نبض تیم امروز', group: 'ی — داشبورد و نبض تیم',
    trigger: 'chip:85', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'computeTeamPulse', needsConfirm: false, maxTokens: 0,
    load: () => loadTeamPulseToday()
  },
  {
    id: 'daily-report', n: 92, title_fa: 'گزارش روزانهٔ تیم', group: 'ی — داشبورد و نبض تیم',
    trigger: 'chip:92', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'sections' },
    fallback: 'computeDeadlineGuardian+computeTeamPulse', needsConfirm: false, maxTokens: 0,
    load: (inputs) => loadDailyReport(inputs.projectId)
  },
  {
    id: 'member-activity', n: 95, title_fa: 'آخرین فعالیت هر عضو', group: 'ک — اعضا و تیم',
    trigger: 'chip:95', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'rows' },
    fallback: 'lastActivityByMember', needsConfirm: false, maxTokens: 0,
    load: () => lastActivity()
  },
  {
    id: 'create-doc-from-template', n: 99, title_fa: 'پیشنهاد قالب برای سند تازه', group: 'ل — قالب‌ها و شروع سریع',
    trigger: 'chip:99', existing: null, chip: true, ai: false,
    system: null, userTemplate: null, context: {}, output: { type: 'templates' },
    fallback: 'listTemplates', needsConfirm: true, maxTokens: 0,
    load: () => listDocTemplates()
  }
]

// ---------- توضیح و دامنهٔ ورودیِ کارت‌های G6 ----------
// desc در کارت نمایش داده می‌شود؛ scope می‌گوید کدام ورودیِ مشترک
// (پروژه/سند/واژه) برای اجرا لازم است. فقط کارت‌های G6 این دو را دارند.
const G6_META = {
  1: ['کارهای باز / در حال انجام / تمام‌شده، عقب‌مانده، سندها، فایل‌های تازه.', 'project'],
  3: ['مهلت پروژه، روزهای مانده و کارهای ناتمام تا مهلت.', 'project'],
  8: ['وقتی همهٔ کارها تمام شده‌اند و پروژه در بازبینی است، بستن را پیشنهاد می‌دهد — بستن فقط با یک تپ شما.', 'project'],
  13: ['پیام‌های امروز تهران در همهٔ اتاق‌ها، تازه‌ترین اول.', 'none'],
  15: ['پیام‌هایی که هیچ پاسخی نگرفته‌اند — قدیمی‌ترین اول.', 'project'],
  23: ['بحث‌هایی که پاسخ دارند، با شمار پاسخ‌ها و آخرین پاسخ.', 'project'],
  25: ['منشن‌های من، خوانده‌نشده اول — فقط اتاق و فرستنده، بدون متن پیام.', 'none'],
  27: ['اعلان‌های خوانده‌نشدهٔ من، دسته‌بندی‌شده بر اساس نوع.', 'none'],
  33: ['سندهایی که ۷ روز یا بیشتر ویرایش نشده‌اند.', 'project'],
  41: ['نظرهای باز یک سند با نقل عین متن و لنگر.', 'doc'],
  45: ['فهرست نسخه‌ها با شماره، نویسنده، یادداشت و زمان.', 'doc'],
  49: ['فایل‌های ۷ روز اخیر با اندازه و فرستنده.', 'project'],
  54: ['فایل‌هایی که آپلود شده‌اند ولی به هیچ کار/سند/اتاقی وصل نیستند.', 'project'],
  58: ['کارهای سپرده‌شده به من با سررسید امروز تهران.', 'project'],
  59: ['کارهای ناتمام با سررسید گذشته، عقب‌مانده‌ترین اول.', 'project'],
  63: ['کارهای ناتمام بدون تاریخ سررسید — در هیچ منویی دیده نمی‌شوند.', 'project'],
  64: ['کارهای ناتمام بدون مسئول.', 'project'],
  71: ['یادآوری‌های من با سررسید امروز تهران.', 'none'],
  72: ['یادآوری‌های من با سررسید گذشته و انجام‌نشده.', 'none'],
  84: ['خط‌هایی از متن واقعی سندها که واژه را دارند، با نقل عین خط.', 'project-word'],
  85: ['چهار عدد نبض: پیام‌های امروز، کارهای تمام‌شدهٔ این هفته، سندهای فعال، فایل‌های تازه.', 'none'],
  92: ['مهلت‌ها + نبض + منشن‌های خوانده‌نشدهٔ من — شروع روز با یک گزارش.', 'project'],
  95: ['تازه‌ترین فعالیت هر عضو — آخرین بار کی فعال بود؟', 'none'],
  99: ['قالب‌های سند — ساخت سند از قالب فقط با یک تپ شما.', 'none']
}
for (const a of ASSISTANT_ACTIONS) {
  if (a.n !== null && G6_META[a.n]) {
    a.desc = G6_META[a.n][0]
    a.scope = G6_META[a.n][1]
  }
}

// ---------- دسترسی ----------

export function getAction(id) {
  return ASSISTANT_ACTIONS.find((a) => a.id === id) || null
}

export function getActionByNumber(n) {
  return ASSISTANT_ACTIONS.find((a) => a.n === n) || null
}

// ریل چیپ: ۳۰ اکشن چیپ‌دار، گروه‌بندی‌شده به همان ۱۲ گروه الف تا ل.
// ترتیب گروه‌ها و چیپ‌ها همان ترتیب ریل امروز است.
export function chipGroups() {
  const groups = []
  const byLabel = new Map()
  for (const a of ASSISTANT_ACTIONS) {
    if (!a.chip) continue
    let g = byLabel.get(a.group)
    if (!g) {
      g = { label: a.group, cmds: [] }
      byLabel.set(a.group, g)
      groups.push(g)
    }
    g.cmds.push({ n: a.n, title: a.title_fa, existing: a.existing || undefined, id: a.id })
  }
  return groups
}

// کارت‌های G6: ۲۴ اکشن تازه (چیپ‌دار، بدون بخش قدیمی)، به ترتیب شماره.
export function g6Actions() {
  return ASSISTANT_ACTIONS.filter((a) => a.chip && !a.existing)
}

// شمار اکشن‌های هوشیِ پکیج B (برای برچسب وضعیت پنل).
export function aiActionIds() {
  return ASSISTANT_ACTIONS.filter((a) => a.ai).map((a) => a.id)
}
