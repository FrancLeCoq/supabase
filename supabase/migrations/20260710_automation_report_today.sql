-- RPC lue par l'edge function daily-report : etat d'envoi des messages
-- automatises du jour (historique cron + journal daily_news_log).
create or replace function public.automation_report_today()
returns jsonb
language sql
security definer
set search_path = public, cron
as $$
  select jsonb_build_object(
    'day', (now() at time zone 'Europe/Paris')::date,
    'crons', coalesce((
      select jsonb_agg(distinct j.jobname)
      from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
      where d.status = 'succeeded'
        and (d.start_time at time zone 'Europe/Paris')::date = (now() at time zone 'Europe/Paris')::date
    ), '[]'::jsonb),
    'slots', coalesce((
      select jsonb_agg(distinct slot)
      from public.daily_news_log
      where day = (now() at time zone 'Europe/Paris')::date
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.automation_report_today() to service_role, anon, authenticated;
