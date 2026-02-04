-- 주간보고 테이블 (최신 1건만 유지, 업로드 시 교체)
create table if not exists public.weekly_report (
  id uuid primary key default gen_random_uuid(),
  week_label text default '',
  complete_data jsonb default '[]',
  scheduled_data jsonb default '[]',
  created_at timestamptz default now()
);

alter table public.weekly_report enable row level security;
create policy "Anyone can read weekly_report" on public.weekly_report for select using (true);
