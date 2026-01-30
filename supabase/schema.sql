-- Supabase 대시보드 데이터 테이블
-- Supabase 대시보드 → SQL Editor에서 이 스크립트 실행

create table if not exists public.dashboard_rows (
  id uuid primary key default gen_random_uuid(),
  month text not null default '',
  cat1 text not null default '',
  cat2 text not null default '',
  cat3 text not null default '',
  count int not null default 0,
  rev bigint not null default 0,
  purchase bigint not null default 0,
  labor bigint not null default 0,
  sga bigint not null default 0,
  created_at timestamptz default now()
);

-- RLS: 누구나 읽기 가능, 쓰기는 서비스 역할(API)만
alter table public.dashboard_rows enable row level security;

create policy "Anyone can read"
  on public.dashboard_rows for select
  using (true);

-- insert/update/delete는 policy 없음 → anon 키로는 불가, service_role로만 가능

-- 인덱스 (월 기준 필터/정렬)
create index if not exists idx_dashboard_rows_month on public.dashboard_rows (month);
