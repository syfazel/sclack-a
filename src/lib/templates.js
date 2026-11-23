// The 4 built-in templates (same four as the Space app, phase 4) +
// 3 task templates (phase 8). Pure data — no imports, so the sandbox
// probe can read it in Node.
// `structure.kind` is 'doc' (creates a doc), 'project' (creates a
// project + auto room + auto doc) or 'task' (creates a task in the
// current project, with an optional checklist and a due date in days).
// Doc templates carry their skeleton text; the project template carries
// the skeleton for its auto doc; task templates carry a title,
// description, checklist items and dueInDays.

export const BUILTIN_TEMPLATES = [
  {
    name: 'یادداشت جلسه',
    type: 'doc',
    structure: {
      kind: 'doc',
      skeleton: [
        'دستور جلسه',
        '',
        'حاضرین',
        '',
        'تصمیم‌ها',
        '',
        'کارهای بعدی',
        ''
      ].join('\n')
    }
  },
  {
    name: 'فهرست کار',
    type: 'doc',
    structure: {
      kind: 'doc',
      skeleton: [
        'فهرست کار',
        '',
        '۱. ',
        '۲. ',
        '۳. ',
        ''
      ].join('\n')
    }
  },
  {
    name: 'سند خالی',
    type: 'doc',
    structure: {
      kind: 'doc',
      skeleton: ''
    }
  },
  {
    name: 'پروژه با یادداشت جلسه',
    type: 'project',
    structure: {
      kind: 'project',
      skeleton: [
        'دستور جلسه',
        '',
        'حاضرین',
        '',
        'تصمیم‌ها',
        '',
        'کارهای بعدی',
        ''
      ].join('\n')
    }
  },
  {
    name: 'کار با چک‌لیست',
    type: 'task',
    structure: {
      kind: 'task',
      title: 'کار با چک‌لیست',
      description: 'کار تازه با سه مرحلهٔ آماده‌سازی، اجرا و بازبینی.',
      checklist: ['آماده‌سازی', 'اجرا', 'بازبینی']
    }
  },
  {
    name: 'کار با مهلت یک هفته‌ای',
    type: 'task',
    structure: {
      kind: 'task',
      title: 'کار با مهلت یک هفته‌ای',
      description: 'کار تازه با سررسید ۷ روز بعد.',
      dueInDays: 7
    }
  },
  {
    name: 'زیروظیفهٔ مرحله',
    type: 'task',
    structure: {
      kind: 'task',
      title: 'زیروظیفهٔ مرحله',
      description: 'زیروظیفهٔ تازه؛ پس از ساختن، از «ویرایش» کارِ والد آن را انتخاب کنید.'
    }
  }
]
