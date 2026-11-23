-- پکیج B — دستیار میوز: جدول سابقهٔ گفت‌وگو assistant_messages
-- پروژه: sclack-a (bbmjurrbkgnysnrtxbnz) — اجرا در Supabase SQL Editor
-- قابل اجرای دوباره: create table / create index با IF NOT EXISTS و
-- همهٔ سیاست‌ها با DROP هم‌نامِ قبلی محافظت شده‌اند.
-- هیچ کلید/رمزی در این فایل نیست؛ هیچ داده‌ای ساخته یا پاک نمی‌شود.
-- هیچ تغییری در سیاست‌های جدول‌های دیگر نیست.
--
-- مدل دسترسی (همان الگوی w1 برای reminders — کاملاً شخصی):
-- گفت‌وگو مال همان عضوی است که پرسیده؛ خواندن/درج/به‌روزرسانی/حذف
-- فقط ردیف‌های خود کاربر (user_id در members با auth_id = auth.uid()).
-- هیچ سیاستی به anon نمی‌رسد؛ بدون نشست صفر ردیف خوانده می‌شود.
-- کلاینت فقط ۲۰ نوبت آخر (۴۰ ردیف) را نگه می‌دارد و قدیمی‌ترها را
-- خودش هرس می‌کند (assistant-core.js)؛ تابع لبه از همین جدول سقف
-- روزانهٔ هر کاربر (۴۰ پیام در روز) را می‌شمرد.
--
-- پس از اجرا: جدول در REST با کلید anon باید ۲۰۰ با [] برگرداند
-- (مثل ۱۳ جدول دیگر) و ردیف assistant_messages در schema cache باشد
-- (دیگر PGRST205 ندهد).

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.members(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  action text,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists assistant_messages_user_created_idx
  on public.assistant_messages (user_id, created_at desc);

alter table public.assistant_messages enable row level security;

drop policy if exists "w1 assistant_messages select own" on public.assistant_messages;
create policy "w1 assistant_messages select own" on public.assistant_messages
  for select to authenticated
  using (user_id in (select id from public.members where auth_id = auth.uid()));

drop policy if exists "w1 assistant_messages insert own" on public.assistant_messages;
create policy "w1 assistant_messages insert own" on public.assistant_messages
  for insert to authenticated
  with check (user_id in (select id from public.members where auth_id = auth.uid()));

drop policy if exists "w1 assistant_messages update own" on public.assistant_messages;
create policy "w1 assistant_messages update own" on public.assistant_messages
  for update to authenticated
  using (user_id in (select id from public.members where auth_id = auth.uid()))
  with check (user_id in (select id from public.members where auth_id = auth.uid()));

drop policy if exists "w1 assistant_messages delete own" on public.assistant_messages;
create policy "w1 assistant_messages delete own" on public.assistant_messages
  for delete to authenticated
  using (user_id in (select id from public.members where auth_id = auth.uid()));

comment on table public.assistant_messages is
  'سابقهٔ گفت‌وگوی باز با دستیار میوز (پکیج B) — ۲۰ نوبت آخر به‌ازای هر عضو؛ role: user/assistant؛ sources: شناسه‌های ردیف منبع جواب (R1).';

-- ============ راستی‌آزمایی (فقط خواندنی؛ جدا اجرا کن، نه در همین اسکریپت) ============
-- ۱) جدول + ۴ سیاست تازه (در مجموع ۵۳ سیاست روی ۱۴ جدول):
-- select tablename, policyname, cmd, roles from pg_policies
--  where schemaname = 'public' and tablename = 'assistant_messages'
--  order by policyname;
-- ۲) هیچ سیاستی نباید به anon برسد (خروجی باید خالی باشد):
-- select tablename, policyname from pg_policies
--  where schemaname = 'public' and tablename = 'assistant_messages'
--  and 'anon' = any (roles);
-- ۳) پروب نفوذ (با کلید عمومی و بدون نشست، از REST): خواندن
--    assistant_messages باید ۲۰۰ با [] برگرداند؛ درج بدون نشست رد شود.
