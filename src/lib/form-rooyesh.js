// فرم ساخت‌یافتهٔ ۴۶ سوالی — کاربرگ رسمی رویش (فاز ۶).
//
// منبع دقیق: فایل رسمی کاربرگ استاد
// `~/workspace/user/files/14011017.docx` (خوانده‌شده با پایتون،
// ۲۳ نوامبر ۲۰۲۶) + سند طرح رویش `~/workspace/aim-rooyesh-plan.md`
// (بخش «د — کاربرگ رسمی رویش»). هیچ فیلدی اضافه یا کم نشده است.
//
// شمارش ۴۶ (قاعدهٔ شمارش پلن، بخش ۲ فاز ۶):
//   ۱-الف ۱۱ فیلد + ۱-ب ۱۲ فیلد + ۲-الف ۲ عضو + ۲-ب ۱ تشریح
//   + ۲-ج ۲ درصد + ۲-ه ۸ گویهٔ TRL + ۲-و ۱۰ سؤال = ۴۶.
// جدول ریز هزینه‌ها و جدول مجوزها (۲-د) در شمارش ۴۶ نیستند —
// ریز هزینه‌ها جزئیات همان ۲ درصد است و مجوزها اختیاری‌اند —
// ولی هر دو در فرم هستند چون در فایل رسمی‌اند.
// فیلد جدول با countAs نشان می‌دهد در شمارش چند حساب می‌شود.
//
// نوع‌ها: text | long-text | number | select | yes-no |
//         table (ردیف‌های جدول) | stages (جدول مراحل + تشریح).
// مقدار yes-no: { value: 'yes' | 'no' | null, detail: '' } —
// شرح فقط وقتی پاسخ «بله» است از فرم خواسته می‌شود.
// مقدار stages: { rows: [...], description: '' }.

export const FORM_KIND = 'rooyesh-46'

// ۱۸ حوزهٔ فناوری — عین سند طرح (بخش ۱-ب کاربرگ).
export const TECH_FIELDS = [
  'انرژی‌های نو و تجدیدپذیر',
  'تجهیزات پیشرفتهٔ ساخت، تولید آزمایشگاهی',
  'تجهیزات و مواد پیشرفتهٔ نفت، گاز، پالایش و پتروشیمی',
  'صنایع غذایی و دارویی',
  'علوم زمین',
  'علوم شناختی (علوم انسانی و فناوری‌های نرم)',
  'علوم کشاورزی و منابع طبیعی',
  'فناوری اطلاعات و ارتباطات و نرم‌افزارهای کامپیوتری',
  'فناوری زیستی',
  'فناوری نانو',
  'فناوری‌های ساختمان، راه‌سازی، ریلی و دریایی',
  'محصولات شیمیایی پیشرفته',
  'محیط زیست',
  'مکانیک، الکترونیک، کنترل و مخابرات',
  'مواد پیشرفته',
  'هوافضا',
  'وسایل، ملزومات و تجهیزات پزشکی',
  'سایر'
]

export const INNOVATION_TYPES = [
  'نوآوری در محصول',
  'نوآوری در فرآیند',
  'نوآوری در روش بازاریابی',
  'نوآوری سازمانی'
]

// نکات راهنمای خود کاربرگ (عین فایل رسمی) — بالای فرم نشان داده می‌شود.
export const FORM_GUIDE_NOTES = [
  'تیم حداقل ۳ نفره است؛ هستهٔ طرح رویش شامل یک عضو هیئت علمی یا دانشجوی دکتری یا فارغ‌التحصیل دانشگاه تهران و یک دانشجوی کارشناسی ارشد یا دکتری دانشگاه تهران است.',
  'اگر طرح برگرفته از پایان‌نامه است، استاد راهنمای اول (یا استاد راهنمای اصلی) به‌عنوان مسئول هسته در نظر گرفته می‌شود.',
  'کاربرگ حداکثر ۳ بار برای تکمیل به مجری برگردانده می‌شود؛ پس از آن طرح از فرایند رویش حذف می‌شود.',
  'کاربرگ باید به‌صورت جزئی تکمیل شود، نه کلیات؛ به راهنمای داخل باکس هر سؤال توجه شود.',
  'به نکات ویرایشی و نگارشی توجه شود.'
]

// نشانی ایمیل ارسال کاربرگ در فایل رسمی و سند طرح خالی است —
// باید از فراخوان فعال پارک یا استاد گرفته شود. ساخته نشده.
export const FORM_SUBMIT_EMAIL = null

export const FORM_ROOYESH_46 = {
  kind: FORM_KIND,
  title: 'کاربرگ رسمی رویش — ۴۶ سؤال',
  sections: [
    {
      id: '1-alef',
      title: '۱-الف — اطلاعات متقاضی (۱۱ فیلد)',
      fields: [
        { id: 'name', label: 'نام و نام خانوادگی', type: 'text' },
        { id: 'national_id', label: 'کد ملی', type: 'text' },
        { id: 'mobile', label: 'تلفن همراه', type: 'text' },
        { id: 'address', label: 'آدرس', type: 'long-text' },
        { id: 'postal_code', label: 'کد پستی', type: 'text' },
        { id: 'email', label: 'پست الکترونیک', type: 'text' },
        {
          id: 'relation',
          label: 'نسبت با دانشگاه تهران',
          type: 'select',
          options: ['عضو هیئت علمی', 'دانشجو', 'فارغ‌التحصیل']
        },
        { id: 'degree', label: 'مقطع تحصیلی', type: 'text' },
        { id: 'field', label: 'رشتهٔ تحصیلی', type: 'text' },
        { id: 'faculty', label: 'دانشکده / دانشکدگان', type: 'text' },
        { id: 'department', label: 'گروه آموزشی', type: 'text' }
      ]
    },
    {
      id: '1-be',
      title: '۱-ب — اطلاعات طرح (۱۲ فیلد)',
      fields: [
        { id: 'idea_title', label: 'عنوان ایده', type: 'text' },
        {
          id: 'tech_field',
          label: 'حوزهٔ فناوری',
          type: 'select',
          options: TECH_FIELDS
        },
        { id: 'thesis_title', label: 'عنوان پایان‌نامه', type: 'text' },
        { id: 'supervisors', label: 'استادان راهنما', type: 'text' },
        { id: 'advisors', label: 'استادان مشاور', type: 'text' },
        {
          id: 'target_level',
          label: 'سطح هدف',
          type: 'select',
          options: ['MVP', 'POC']
        },
        {
          id: 'is_soft_tech',
          label: 'فناوری نرم',
          type: 'yes-no',
          hint: 'فناوری نرم: فناوری‌هایی که خروجی آن‌ها محصول فیزیکی نیست (مثل نرم‌افزار، محتوا، خدمات).'
        },
        { id: 'goal', label: 'هدف', type: 'long-text' },
        { id: 'final_output', label: 'خروجی نهایی', type: 'long-text' },
        {
          id: 'innovation_type',
          label: 'نوع نوآوری',
          type: 'select',
          options: INNOVATION_TYPES
        },
        { id: 'innovation_desc', label: 'شرح نوآوری', type: 'long-text' },
        {
          id: 'studies',
          label: 'مطالعات و سوابق (با رفرنس)',
          type: 'long-text'
        }
      ]
    },
    {
      id: '2-alef',
      title: '۲-الف — اعضای تیم (حداقل ۲ عضو)',
      fields: [
        {
          id: 'members',
          label: 'اعضای تیم',
          type: 'table',
          countAs: 2,
          minRows: 2,
          columns: [
            { id: 'name', label: 'نام و نام خانوادگی', type: 'text' },
            { id: 'national_id', label: 'کد ملی', type: 'text' },
            { id: 'degree', label: 'مقطع تحصیلی', type: 'text' },
            { id: 'university', label: 'دانشگاه / دانشکدگان', type: 'text' },
            { id: 'field', label: 'رشتهٔ تحصیلی', type: 'text' },
            { id: 'mobile', label: 'تلفن همراه', type: 'text' },
            { id: 'email', label: 'پست الکترونیک', type: 'text' },
            { id: 'relation', label: 'نوع ارتباط با دانشگاه تهران', type: 'text' },
            { id: 'role', label: 'سمت / نوع همکاری', type: 'text' }
          ]
        }
      ]
    },
    {
      id: '2-be',
      title: '۲-ب — برنامهٔ اجرایی (مراحل + تشریح)',
      fields: [
        {
          id: 'stages',
          label: 'مراحل اجرای طرح',
          type: 'stages',
          countAs: 1,
          hint: 'زمان قابل استفاده در برنامهٔ رویش ۶ ماه و در برنامهٔ شکوفایی ۱۲ ماه است. درصد هر مرحله ۴۰ تا ۶۰٪ و جمع درصدها ۱۰۰٪ است.',
          columns: [
            { id: 'title', label: 'عنوان مرحله', type: 'text' },
            { id: 'percent', label: 'درصد از کل کار', type: 'number' },
            { id: 'months', label: 'مدت زمان اجرا (ماه)', type: 'number' },
            { id: 'output', label: 'دستاورد / خروجی مرحله', type: 'text' }
          ]
        }
      ]
    },
    {
      id: '2-je',
      title: '۲-ج — هزینه‌های طرح',
      fields: [
        {
          id: 'equipment_pct',
          label: 'درصد هزینهٔ تجهیزات',
          type: 'number',
          hint: 'در فناوری‌های سخت ۰ تا ۱۰۰٪؛ در فناوری‌های نرم نسبت تجهیزات به دستیار پژوهشی حداکثر ۵۰ به ۵۰ است.'
        },
        {
          id: 'assistant_pct',
          label: 'درصد هزینهٔ دستیار پژوهشی',
          type: 'number',
          hint: 'حداکثر ۲۰٪؛ در فناوری‌های نرم حداکثر ۵۰٪.'
        },
        {
          id: 'cost_rows',
          label: 'ریز هزینه‌ها',
          type: 'table',
          countAs: 0,
          minRows: 10,
          hint: 'شرح کامل هزینه‌های مورد انتظار برای اجرای کامل طرح.',
          columns: [
            {
              id: 'kind',
              label: 'نوع هزینه',
              type: 'select',
              options: ['تجهیزات', 'دستیار پژوهشی']
            },
            { id: 'title', label: 'عنوان هزینه', type: 'text' },
            { id: 'amount', label: 'برآورد مبلغ (ریال)', type: 'number' }
          ]
        }
      ]
    },
    {
      id: '2-dal',
      title: '۲-د — مجوزها، تأییدیه‌ها و ثبت اختراعات (اختیاری)',
      fields: [
        {
          id: 'licenses',
          label: 'مجوزها',
          type: 'table',
          countAs: 0,
          minRows: 3,
          columns: [
            { id: 'title', label: 'عنوان مجوز، تأییدیه و ثبت اختراع', type: 'text' },
            { id: 'issuer', label: 'مرجع صدور', type: 'text' },
            { id: 'issued_at', label: 'تاریخ اخذ', type: 'text' },
            { id: 'expires_at', label: 'تاریخ انقضا', type: 'text' },
            { id: 'owners', label: 'مالک / مالکین', type: 'text' }
          ]
        }
      ]
    },
    {
      id: '2-he',
      title: '۲-ه — سطح آمادگی فناوری (TRL — ۸ گویه)',
      fields: [
        {
          id: 'trl_1',
          label: 'آیا مشاهدهٔ اصول اساسی ایده صورت گرفته است؟',
          type: 'yes-no',
          hint: 'در این مرحله نیازهای فناوری مطابق با مطالعات تعریف می‌شود.'
        },
        {
          id: 'trl_2',
          label: 'آیا مطالعات امکان‌سنجی، جهت کاربردی شدن فناوری صورت گرفته است؟',
          type: 'yes-no',
          hint: 'اصول پایه‌ای مطالعه شد و برنامه‌های کاربردی عملی برای یافته‌های اولیه فرموله می‌شود؛ این برنامه‌ها نظری‌اند و هنوز اثبات نشده‌اند.'
        },
        {
          id: 'trl_3',
          label: 'بر اساس مطالعات صورت گرفته آیا امکان‌پذیری ایده بررسی شده و توانایی دستیابی به دستاورد نهایی را برای شما مهیا می‌کند؟',
          type: 'yes-no',
          hint: 'تحقیق و طراحی پویا که شامل مطالعات تحلیلی/آزمایشگاهی است تا اثبات شود آیا فناوری قابل دوام و آماده برای پیشرفت بیشتر است یا خیر (اثبات مفهومی ایده).'
        },
        {
          id: 'trl_4',
          label: 'آیا اعتبارسنجی اجزا و یا نمونهٔ کوچک‌مقیاس از محصول/خدمت در محیط آزمایشگاهی صورت گرفته است؟',
          type: 'yes-no',
          hint: 'اجزای مختلف فناوری در یک نمونهٔ کوچک‌مقیاس در محیط آزمایشگاهی مورد آزمون قرار می‌گیرند.'
        },
        {
          id: 'trl_5',
          label: 'آیا اعتبارسنجی اجزا و یا نمونهٔ کوچک‌مقیاس از محصول/خدمت در محیط مناسب و شبیه‌سازی‌شده صورت گرفته است؟',
          type: 'yes-no',
          hint: 'اجزای اصلی فناوری با شرایط سخت‌گیرانه‌تر در محیط‌های شبیه‌سازی‌شده به محیط واقعی مورد آزمون قرار می‌گیرند.'
        },
        {
          id: 'trl_6',
          label: 'آیا به نمونهٔ محصول/خدمت اولیه که دارای مشخصات و ویژگی‌های مورد انتظار از محصول/خدمت نهایی است، توانسته‌اید دست پیدا کنید؟',
          type: 'yes-no',
          hint: 'نمونهٔ اولیه حداقل محصول قابل دوامی است که ویژگی‌های اصلی مورد انتظار از محصول نهایی را دارد.'
        },
        {
          id: 'trl_7',
          label: 'آیا به نمونه/خدمت‌های پیش‌تولید توانسته‌اید دست پیدا کنید؟',
          type: 'yes-no',
          hint: 'نمونه‌های حاصل از اولین سری تولید، قبل از تولید انبوه، برای تأیید نهایی مطابق با نیاز مشتری.'
        },
        {
          id: 'trl_8',
          label: 'آیا توانسته‌اید محصول/خدمت را به تولید انبوه برسانید؟',
          type: 'yes-no',
          hint: 'فروش و تجاری‌سازی محصول به‌صورت گسترده.'
        }
      ]
    },
    {
      id: '2-vav',
      title: '۲-و — شناخت بازار (۱۰ سؤال)',
      fields: [
        {
          id: 'market_1',
          label: 'محصول/خدمت پیشنهادی در پاسخ به چه نیازی در جامعه می‌باشد؟',
          type: 'long-text'
        },
        {
          id: 'market_2',
          label: 'محصول/خدمتی که در حال حاضر پاسخگوی نیاز مربوطه در جامعه است را معرفی فرمایید.',
          type: 'long-text'
        },
        {
          id: 'market_3',
          label: 'رقبای غیرمستقیم خود را معرفی نمایید. (رقبایی که محصول آن‌ها مشابه محصول شما نمی‌باشد ولی قابلیت جایگزینی و کاربری محصول آن‌ها به جای محصول شما وجود دارد)',
          type: 'long-text'
        },
        {
          id: 'market_4',
          label: 'رقبای مستقیم خود را معرفی نمایید. (رقبایی که محصول آن‌ها از نظر تکنولوژی و کاربری کاملاً مشابه محصول شما می‌باشد)',
          type: 'long-text'
        },
        {
          id: 'market_5',
          label: 'برای چه کسانی ارزش‌آفرینی می‌کنید؟ مهم‌ترین مشتریان شما چه کسانی هستند؟ (خصوصی یا دولتی)',
          type: 'long-text'
        },
        {
          id: 'market_6',
          label: 'آیا محصول/خدمت مورد نظر دارای ارجحیت فناورانه (مزیت رقابتی) نسبت به انواع موجود در بازار است؟ (چه ارزشی به مشتریان ارائه می‌دهید؟ کدام یک از مشکلات مشتریان را حل می‌کنید؟)',
          type: 'long-text'
        },
        {
          id: 'market_7',
          label: 'آیا در مورد نحوهٔ رساندن محصول/خدمت به مشتریان خود فکر کرده‌اید؟ (در خصوص روش‌های توزیع محصول/خدمت توضیح دهید)',
          type: 'long-text'
        },
        {
          id: 'market_8',
          label: 'آیا فکر می‌کنید در مسیر توسعهٔ ایدهٔ خود نیاز به سرمایه‌گذار، حامی فنی و یا سازمانی دارید؟ در چه مرحله‌ای و چگونه؟',
          type: 'long-text'
        },
        {
          id: 'market_9',
          label: 'آیا به روش درآمدی خود فکر کرده‌اید؟',
          type: 'long-text'
        },
        {
          id: 'market_10',
          label: 'آیا به هزینه‌های توسعه و نگهداری محصول/خدمت مد نظر خود فکر کرده‌اید؟',
          type: 'long-text'
        }
      ]
    }
  ]
}

// شمارش ۴۶ طبق قاعدهٔ پلن (بالا). جدول اعضا ۲ حساب می‌شود،
// مراحل ۱، ریز هزینه‌ها و مجوزها ۰.
export function countRooyeshFields(def = FORM_ROOYESH_46) {
  let total = 0
  for (const section of def.sections) {
    for (const field of section.fields) {
      total += field.countAs !== undefined ? field.countAs : 1
    }
  }
  return total
}

// پاسخ خالی برای همهٔ فیلدها.
export function emptyFormAnswers(def = FORM_ROOYESH_46) {
  const answers = {}
  for (const section of def.sections) {
    for (const field of section.fields) {
      if (field.type === 'yes-no') answers[field.id] = { value: null, detail: '' }
      else if (field.type === 'table')
        answers[field.id] = Array.from({ length: field.minRows || 1 }, () => ({}))
      else if (field.type === 'stages')
        answers[field.id] = { rows: [{}], description: '' }
      else answers[field.id] = ''
    }
  }
  return answers
}

// یک فیلد اسکالر پر شده؟ (yes-no با value مشخص، یا رشتهٔ غیرخالی)
function scalarFilled(field, value) {
  if (field.type === 'yes-no') return value && value.value !== null && value.value !== undefined
  return typeof value === 'string' ? value.trim() !== '' : value !== null && value !== undefined && value !== ''
}

// پیشرفت تکمیل روی همان ۴۶ خانه: فیلد اسکالر پر = ۱، جدول اعضا
// به‌ازای هر ردیف پر (سقف ۲)، مراحل = ۱ اگر ردیفی یا تشریحی پر شده باشد.
export function formCompletion(answers, def = FORM_ROOYESH_46) {
  const total = countRooyeshFields(def)
  let filled = 0
  for (const section of def.sections) {
    for (const field of section.fields) {
      const value = answers?.[field.id]
      if (field.type === 'table') {
        const rows = Array.isArray(value) ? value : []
        const filledRows = rows.filter((row) =>
          field.columns.some((col) => {
            const v = row?.[col.id]
            return typeof v === 'string' ? v.trim() !== '' : v !== null && v !== undefined && v !== ''
          })
        ).length
        filled += Math.min(filledRows, field.countAs || 0)
      } else if (field.type === 'stages') {
        const rows = Array.isArray(value?.rows) ? value.rows : []
        const anyRow = rows.some((row) =>
          field.columns.some((col) => {
            const v = row?.[col.id]
            return typeof v === 'string' ? v.trim() !== '' : v !== null && v !== undefined && v !== ''
          })
        )
        const desc = typeof value?.description === 'string' && value.description.trim() !== ''
        if (anyRow || desc) filled += field.countAs || 1
      } else if (scalarFilled(field, value)) {
        filled += 1
      }
    }
  }
  return { filled, total, pct: total === 0 ? 0 : Math.round((filled / total) * 100) }
}

// اعتبارسنجی درصدها — فقط هشدار، نه مسدودکردن ذخیره:
//   * درصد هر مرحله ۴۰ تا ۶۰٪ و جمع درصدها ۱۰۰٪ (راهنمای فرم).
//   * درصد تجهیزات + درصد دستیار پژوهشی = ۱۰۰٪.
//   * سقف دستیار پژوهشی: ۲۰٪ در فناوری سخت، ۵۰٪ در فناوری نرم.
export function validateFormPercents(answers) {
  const warnings = []
  const stages = answers?.stages
  const rows = Array.isArray(stages?.rows) ? stages.rows : []
  const percents = rows
    .map((r) => (typeof r?.percent === 'string' ? Number(r.percent) : r?.percent))
    .filter((n) => typeof n === 'number' && !Number.isNaN(n))
  if (percents.length > 0) {
    const outOfRange = percents.filter((n) => n < 40 || n > 60)
    if (outOfRange.length > 0)
      warnings.push('درصد هر مرحله باید ۴۰ تا ۶۰٪ باشد؛ ' + outOfRange.length + ' مرحله خارج از این بازه است.')
    const sum = percents.reduce((a, b) => a + b, 0)
    if (sum !== 100) warnings.push('جمع درصد مراحل ' + sum + '٪ است؛ باید ۱۰۰٪ شود.')
  }
  const equip = Number(answers?.equipment_pct)
  const assist = Number(answers?.assistant_pct)
  const hasEquip = answers?.equipment_pct !== '' && !Number.isNaN(equip)
  const hasAssist = answers?.assistant_pct !== '' && !Number.isNaN(assist)
  if (hasEquip && hasAssist && equip + assist !== 100)
    warnings.push('جمع درصد تجهیزات و دستیار پژوهشی ' + (equip + assist) + '٪ است؛ باید ۱۰۰٪ شود.')
  if (hasAssist) {
    const isSoft = answers?.is_soft_tech?.value === 'yes'
    const cap = isSoft ? 50 : 20
    if (assist > cap)
      warnings.push(
        'درصد دستیار پژوهشی ' +
          assist +
          '٪ است؛ سقف آن در فناوری ' +
          (isSoft ? 'نرم ۵۰٪' : 'سخت ۲۰٪') +
          ' است.'
      )
  }
  return { warnings }
}
