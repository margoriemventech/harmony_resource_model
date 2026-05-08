-- ─── HARMONY RSA RESOURCE MODEL — SUPABASE SCHEMA ───────────────────────────
-- Run this entire file in: Supabase Dashboard → SQL Editor → New Query → Run

-- ─── PROJECTS ────────────────────────────────────────────────────────────────
create table if not exists projects (
  id            text primary key,
  name          text not null,
  type          text not null check (type in ('Underground','Surface')),
  phase         text not null check (phase in ('PFS','FS','FEED','Execution')),
  complexity    text not null default 'High' check (complexity in ('High','Low')),
  finish        text,
  capex         numeric,          -- ZARm execution capital cost
  start_idx     integer not null, -- 0-based month index into the 90-month horizon
  end_idx       integer not null,
  has_asis      boolean default false,
  is_custom     boolean default false,
  -- Summary stats (peak/total values for table display)
  model_mh      numeric,
  model_fte     numeric,
  model_cost    numeric,          -- ZARm total
  asis_mh       numeric,
  asis_fte      numeric,
  asis_cost     numeric,
  -- Scope indicators
  scope_mining   boolean default false,
  scope_process  boolean default false,
  scope_tsf      boolean default false,
  scope_surface  boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ─── PROJECT MONTHLY DATA ─────────────────────────────────────────────────────
-- One row per project per month (18 projects × 90 months = 1,620 rows)
create table if not exists project_monthly_data (
  id          bigserial primary key,
  project_id  text not null references projects(id) on delete cascade,
  month_idx   integer not null check (month_idx between 0 and 89),
  -- Model (benchmarked requirement)
  model_fte   numeric default 0,
  model_cost  numeric default 0,  -- ZARk per month
  -- As-Is (actual deployed)
  asis_fte    numeric default 0,
  asis_cost   numeric default 0,
  -- Entity split FTE
  ot_fte      numeric default 0,
  cpmo_fte    numeric default 0,
  pmo_fte     numeric default 0,
  epcm_fte    numeric default 0,
  unique (project_id, month_idx)
);

-- ─── PORTFOLIO MONTHLY DATA ───────────────────────────────────────────────────
-- One row per month — portfolio-level aggregates (90 rows)
create table if not exists portfolio_monthly_data (
  month_idx       integer primary key check (month_idx between 0 and 89),
  -- Portfolio model totals
  model_fte       numeric default 0,
  model_mh        numeric default 0,
  model_cost      numeric default 0,
  -- Portfolio as-is totals
  asis_fte        numeric default 0,
  asis_mh         numeric default 0,
  asis_cost       numeric default 0,
  -- Entity model FTE
  ot_model_fte    numeric default 0,
  cpmo_model_fte  numeric default 0,
  pmo_model_fte   numeric default 0,
  epcm_model_fte  numeric default 0,
  -- Entity as-is FTE
  ot_asis_fte     numeric default 0,
  cpmo_asis_fte   numeric default 0,
  pmo_asis_fte    numeric default 0,
  epcm_asis_fte   numeric default 0,
  -- Discipline model FTE
  mining_model_fte     numeric default 0,
  process_model_fte    numeric default 0,
  -- Discipline as-is FTE
  mining_asis_fte      numeric default 0,
  process_asis_fte     numeric default 0,
  -- Discipline costs
  mining_model_cost    numeric default 0,
  process_model_cost   numeric default 0,
  mining_asis_cost     numeric default 0,
  process_asis_cost    numeric default 0
);

-- ─── MODEL CONFIG ─────────────────────────────────────────────────────────────
-- Stores all model assumptions: rate cards, PM&D ratios, capacity limits, ramp shapes
-- Key-value with a category so it's easy to query by section
create table if not exists model_config (
  id          bigserial primary key,
  category    text not null,  -- 'rate_card' | 'pmd_ratio' | 'capacity' | 'ramp_shape'
  key         text not null,  -- e.g. 'OT' | 'Execution High' | 'FEED High'
  sub_key     text,           -- e.g. 'Mining' | 'Full' | 'up' | 'down'
  value       numeric,        -- for single numeric values
  value_json  jsonb,          -- for arrays (ramp shapes)
  label       text,           -- human readable description
  updated_at  timestamptz default now(),
  unique (category, key, sub_key)
);

-- ─── AUDIT LOG ────────────────────────────────────────────────────────────────
-- Tracks all changes made through the app
create table if not exists audit_log (
  id          bigserial primary key,
  table_name  text not null,
  record_id   text,
  action      text not null check (action in ('insert','update','delete')),
  old_data    jsonb,
  new_data    jsonb,
  changed_by  text default 'app',
  changed_at  timestamptz default now()
);

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
-- Enable RLS on all tables (required for Supabase anon key access)
alter table projects              enable row level security;
alter table project_monthly_data  enable row level security;
alter table portfolio_monthly_data enable row level security;
alter table model_config          enable row level security;
alter table audit_log             enable row level security;

-- For now: allow full public read and write (we'll tighten this with auth in Phase 3D)
create policy "public read projects"               on projects              for select using (true);
create policy "public write projects"              on projects              for all    using (true);
create policy "public read project_monthly"        on project_monthly_data  for select using (true);
create policy "public write project_monthly"       on project_monthly_data  for all    using (true);
create policy "public read portfolio_monthly"      on portfolio_monthly_data for select using (true);
create policy "public write portfolio_monthly"     on portfolio_monthly_data for all    using (true);
create policy "public read model_config"           on model_config          for select using (true);
create policy "public write model_config"          on model_config          for all    using (true);
create policy "public read audit_log"              on audit_log             for select using (true);
create policy "public write audit_log"             on audit_log             for all    using (true);

-- ─── UPDATED_AT TRIGGER ───────────────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger projects_updated_at
  before update on projects
  for each row execute function update_updated_at();
