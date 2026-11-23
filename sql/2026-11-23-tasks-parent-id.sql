-- فاز ۸ — کانبان + زیروظیفه: ستون parent_id روی tasks
-- پروژه: sclack-a (bbmjurrbkgnysnrtxbnz) — اجرا در Supabase SQL Editor
-- قابل اجرای دوباره: add column با IF NOT EXISTS محافظت شده است.
-- هیچ کلید/رمزی در این فایل نیست؛ هیچ داده‌ای ساخته یا پاک نمی‌شود.
-- هیچ تغییری در سیاست‌های RLS نیست (سیاست‌ها سطری‌اند؛ ستون تازه
-- همان سیاست‌های جدول tasks را دارد).
--
-- حذف کارِ والد (اگر روزی از داشبورد یا اسکریپت انجام شود) زیروظیفه‌ها
-- را به ریشه برمی‌گرداند (on delete set null) — در خود اپ حذف کار
-- وجود دارد (deleteTask) و این رفتار در سطح دیتابیس تعریف شده است.
-- تا وقتی این مهاجرت اجرا نشده، کدِ دیپلوی‌شده با نگهبان ستون ناموجود
-- (work.js: setTaskParent) تعیین والد را با پیام روشن رد می‌کند و درخت
-- همهٔ کارها را در ریشه نشان می‌دهد؛ هیچ‌چیز دیگری نمی‌شکند.
alter table public.tasks add column if not exists parent_id uuid references public.tasks(id) on delete set null;

comment on column public.tasks.parent_id is
  'والد کار برای زیروظیفه (فاز ۸، تصمیم D7)؛ خالی یعنی کار در ریشه است.';
