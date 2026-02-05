-- unpaid_items에 project_name 컬럼 추가
alter table public.unpaid_items add column if not exists project_name text default '';
