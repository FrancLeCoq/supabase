-- Verrou PARTAGÉ (DB) pour garantir UNE seule réponse par fenêtre même quand
-- Telegram répartit les messages d'une salve sur plusieurs instances de la
-- fonction (l'anti-flood en mémoire ne suffisait pas -> 3 réponses observées).
create table if not exists public.chat_reply_lock (
  chat_key     text        primary key,
  scheduled_at timestamptz not null default now()
);
alter table public.chat_reply_lock enable row level security;  -- service_role only

-- Claim atomique : TRUE seulement à l'instance qui obtient le créneau.
create or replace function public.claim_reply_slot(p_chat_key text, p_window_seconds int default 90)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed boolean;
begin
  insert into public.chat_reply_lock(chat_key, scheduled_at) values (p_chat_key, now())
  on conflict (chat_key) do update set scheduled_at = now()
    where public.chat_reply_lock.scheduled_at < now() - make_interval(secs => p_window_seconds)
  returning true into claimed;
  return coalesce(claimed, false);
end; $$;
revoke execute on function public.claim_reply_slot(text, int) from anon, authenticated;
grant  execute on function public.claim_reply_slot(text, int) to service_role;

-- Purge 23:00 Paris (appliquée via cron.schedule 'chat-memory-cleanup') vide
-- désormais chat_memory ET chat_reply_lock.
