// The 4 built-in templates (same four as the Space app, phase 4).
// Pure data — no imports, so the sandbox probe can read it in Node.
// `structure.kind` is 'doc' (creates a doc) or 'project' (creates a
// project + auto room + auto doc). Doc templates carry their skeleton text;
// the project template carries the skeleton for its auto doc.

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
  }
]
