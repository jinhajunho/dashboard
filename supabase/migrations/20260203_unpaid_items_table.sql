-- 1) 기존 unpaid_items 삭제 후 새로 생성 (건물명, 매출발행일, 공급가액만)
drop table if exists public.unpaid_items;

create table public.unpaid_items (
  id uuid primary key default gen_random_uuid(),
  month text default '',
  building_name text default '',
  invoice_date text default '',
  supply_amount bigint default 0,
  created_at timestamptz default now()
);

alter table public.unpaid_items enable row level security;
create policy "Anyone can read unpaid_items" on public.unpaid_items for select using (true);

-- 2) dashboard_rows에서 미수금 컬럼 제거 (이전에 추가했던 경우)
alter table public.dashboard_rows drop column if exists building_name;
alter table public.dashboard_rows drop column if exists invoice_date;
alter table public.dashboard_rows drop column if exists progress_status;
alter table public.dashboard_rows drop column if exists payment_status;
alter table public.dashboard_rows drop column if exists payment_amount;
alter table public.dashboard_rows drop column if exists supply_amount;
