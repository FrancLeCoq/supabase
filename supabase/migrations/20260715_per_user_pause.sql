-- Pause de Francis par UTILISATEUR et par contexte (scope).
--   scope: 'dm' (privé + Business) | 'poulailler' | 'chickencoop'
create table if not exists public.user_pause (
  scope     text        not null,
  username  text        not null,
  paused    boolean     not null default true,
  added_at  timestamptz not null default now(),
  primary key (scope, username)
);
alter table public.user_pause enable row level security;  -- service_role only

-- État "en attente d'un pseudo" du owner (flux /stopbot…user).
create table if not exists public.admin_pending (
  owner_id   text        primary key,
  action     text        not null,
  created_at timestamptz not null default now()
);
alter table public.admin_pending enable row level security;  -- service_role only
