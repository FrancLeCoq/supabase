-- Ces 6 tables etaient les dernieres du schema public sans RLS : avec les
-- grants Supabase par defaut, n'importe qui disposant de la cle anon pouvait
-- les lire ET les modifier.
--
-- Elles ne sont ecrites que par les fonctions Edge, qui utilisent
-- SUPABASE_SERVICE_ROLE_KEY (cf. storeI18n dans daily-fact-dyk) : le role
-- service_role contourne RLS, ces fonctions continuent donc de fonctionner.
--
-- On ne cree volontairement aucune policy : c'est exactement le schema deja
-- en place sur automation_sent, daily_news_log, chat_reply_lock, franc_mc_snap
-- et les autres tables du bot -> ferme a anon/authenticated, ouvert au seul
-- service_role.

alter table public.breaking_pending enable row level security;
alter table public.gr_reminder      enable row level security;
alter table public.news_i18n        enable row level security;
alter table public.setup_i18n       enable row level security;
alter table public.welcome_pending  enable row level security;
alter table public.xtrend_pending   enable row level security;
