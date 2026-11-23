-- فاز ۳ — جست‌وجوی متن سند: ستون search_text روی docs
-- پروژه: sclack-a (bbmjurrbkgnysnrtxbnz) — اجرا در Supabase SQL Editor
-- قابل اجرای دوباره: add column با IF NOT EXISTS محافظت شده است.
-- هیچ کلید/رمزی در این فایل نیست؛ هیچ داده‌ای ساخته یا پاک نمی‌شود.
-- هیچ تغییری در سیاست‌های RLS نیست (سیاست‌ها سطری‌اند؛ ستون تازه
-- همان سیاست‌های جدول docs را دارد).
--
-- پس از اجرا: بک‌فیل یک‌بارهٔ سندهای موجود با
--   scripts/backfill-search-text.mjs
-- (با SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY؛ اول --dry-run).
-- تا وقتی این مهاجرت اجرا نشده، کدِ دیپلوی‌شده با نگهبان ستون ناموجود
-- (docs.js / work.js) ذخیرهٔ سند و جست‌وجو را سالم نگه می‌دارد.
alter table public.docs add column if not exists search_text text;

comment on column public.docs.search_text is
  'متن سادهٔ سند (از Yjs، سقف ۲۰۰۰۰ نویسه — تصمیم D2) برای جست‌وجوی سراسری؛ هنگام ذخیرهٔ سند در saveDocRow نوشته می‌شود.';
