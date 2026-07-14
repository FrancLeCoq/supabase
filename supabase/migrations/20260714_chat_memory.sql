-- Mémoire courte de conversation (cohérence) pour le privé/Business.
-- Garde les derniers messages par conversation, VIDÉE chaque soir à 23:00
-- (heure de Paris) via cron → base légère et propre.
create table if not exists public.chat_memory (
  id         bigint generated always as identity primary key,
  chat_key   text        not null,
  role       text        not null,   -- 'user' | 'model'
  content    text        not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_memory_key_time on public.chat_memory (chat_key, created_at);
alter table public.chat_memory enable row level security;  -- service_role only

-- Purge quotidienne (appliquée via cron.schedule) : 23:00 Paris, figé été/hiver.
--   cron 'chat-memory-cleanup' : '0 21,22 * * *' + garde-fou to_char(Europe/Paris)=23:00
--   -> DELETE FROM public.chat_memory;
