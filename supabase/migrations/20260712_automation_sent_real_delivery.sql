-- Journal des ENVOIS REELS : chaque fonction y ecrit une ligne UNIQUEMENT
-- apres une publication Telegram reussie (helper markSent). Le rapport de
-- 22h20 lit cette table au lieu de cron.job_run_details.
create table if not exists public.automation_sent (
  day      date        not null,
  job_key  text        not null,
  sent_at  timestamptz not null default now(),
  primary key (day, job_key)
);
alter table public.automation_sent enable row level security; -- service_role only

drop function if exists public.automation_report_today();
create function public.automation_report_today()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'day', to_char(current_date, 'YYYY-MM-DD'),
    'crons', coalesce(
      (select json_agg(job_key order by job_key)
         from public.automation_sent where day = current_date), '[]'::json)
  );
$$;
revoke execute on function public.automation_report_today() from anon, authenticated;
grant  execute on function public.automation_report_today() to service_role;

-- Rappel (applique via cron.schedule) : les crons hot/pump passent un "slot"
-- dans leur corps pour que markSent identifie le creneau publie. Voir cron.job.
