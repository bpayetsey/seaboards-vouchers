-- =====================================================================
--  Seaboards Golden Jubilee — Group Voucher schema
--  Run once against your Postgres database (Replit / Railway).
--  Requires pgcrypto for gen_random_uuid():  create extension if not exists pgcrypto;
-- =====================================================================
create extension if not exists pgcrypto;

-- A single group purchase, created by an organiser.
--   mode = 'independent' -> each line is its own voucher (one flake = one failed line)
--   mode = 'split'       -> all lines fund ONE shared voucher (all-or-nothing)
create table if not exists group_order (
  id                    uuid primary key default gen_random_uuid(),
  mode                  text not null check (mode in ('independent','split')),
  organiser_name        text not null,
  organiser_email       text not null,
  status                text not null default 'open'
                          check (status in ('open','complete','expired','cancelled')),

  -- 'split' mode only: the single apartment all shares pay toward
  split_apartment_type  text check (split_apartment_type in ('one_bedroom','two_bedroom')),
  split_nights          integer,
  split_voucher_code    text,            -- issued once every share is paid

  currency              text not null default 'SCR',
  due_by                timestamptz,     -- pay-by deadline (e.g. offer close, 30 Sep 2026)
  status_token          text not null unique,  -- organiser status-page access token
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- One payable line per person. In 'independent' mode each line becomes a voucher;
-- in 'split' mode each line is one person's share of the single shared voucher.
create table if not exists voucher_line (
  id                uuid primary key default gen_random_uuid(),
  group_order_id    uuid not null references group_order(id) on delete cascade,

  -- independent mode: the apartment/nights this person is buying
  apartment_type    text check (apartment_type in ('one_bedroom','two_bedroom')),
  nights            integer,

  amount_minor      bigint not null,     -- amount due, in MINOR units (e.g. cents) of currency
  payer_name        text not null,
  payer_email       text not null,

  pay_token         text not null unique,-- stable per-person link token (-> /pay/:pay_token)
  status            text not null default 'pending'
                      check (status in ('pending','paid','expired','refunded')),
  stripe_session_id text,
  paid_at           timestamptz,

  voucher_code      text,                -- independent mode: voucher issued when paid
  credit_code       text,                -- split mode: Ezzy Group Credit if share is converted

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_voucher_line_order  on voucher_line(group_order_id);
create index if not exists idx_voucher_line_status on voucher_line(status);
create index if not exists idx_voucher_line_paytok on voucher_line(pay_token);
