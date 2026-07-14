-- Mode "secrétaire" (Telegram Business). Mémorise la connexion du bot à un
-- compte Business (owner_id = titulaire) pour répondre via le bon
-- business_connection_id et ne jamais répondre au titulaire (anti-boucle).
create table if not exists public.business_connections (
  id          text        primary key,
  owner_id    text        not null,
  is_enabled  boolean     not null default true,
  can_reply   boolean     not null default true,
  updated_at  timestamptz not null default now()
);
alter table public.business_connections enable row level security; -- service_role only
