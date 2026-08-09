-- Chicken Reflex : classement quotidien du mini-jeu de reflexes.
-- Le jour est calcule en Europe/Paris (reset a minuit heure de Paris).

create table if not exists public.reflex_scores (
  id          uuid primary key default gen_random_uuid(),
  player_id   text not null,
  player_name text not null default 'Anon',
  score       int  not null,
  hits        int  not null default 0,
  misses      int  not null default 0,
  best_ms     int,
  avg_ms      int,
  mode        text not null default 'classic',
  day         date not null default ((now() at time zone 'Europe/Paris')::date),
  created_at  timestamptz not null default now()
);

comment on table public.reflex_scores is
  'Parties du mini-jeu Chicken Reflex. Une ligne = une partie. Le classement quotidien prend le meilleur score par joueur et par jour (jour = date Europe/Paris). Ecriture uniquement via submit_reflex_score(), lecture via reflex_leaderboard().';

create index if not exists reflex_scores_board_idx
  on public.reflex_scores (day, mode, score desc, best_ms asc);
create index if not exists reflex_scores_player_idx
  on public.reflex_scores (player_id, created_at desc);

alter table public.reflex_scores enable row level security;

-- Aucune policy : anon/authenticated ne touchent jamais la table en direct.
-- Tout passe par les deux fonctions SECURITY DEFINER ci-dessous, qui valident les entrees.
revoke all on public.reflex_scores from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enregistre une partie et renvoie le rang du jour.
-- ---------------------------------------------------------------------------
create or replace function public.submit_reflex_score(
  p_player_id   text,
  p_player_name text,
  p_score       int,
  p_hits        int,
  p_misses      int,
  p_best_ms     int,
  p_avg_ms      int,
  p_mode        text default 'classic'
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day   date := (now() at time zone 'Europe/Paris')::date;
  v_pid   text := nullif(btrim(p_player_id), '');
  v_name  text := left(coalesce(nullif(btrim(p_player_name), ''), 'Anon'), 24);
  v_last  timestamptz;
  v_best  int;
  v_rank  int;
  v_total int;
begin
  -- Garde-fous : le client est public, on ne lui fait pas confiance.
  if v_pid is null or length(v_pid) > 64 then
    raise exception 'invalid player_id';
  end if;
  if p_mode is null or p_mode not in ('classic', 'nofox') then
    raise exception 'invalid mode';
  end if;
  if p_hits < 0 or p_hits > 80 or p_misses < 0 or p_misses > 80 then
    raise exception 'invalid counters';
  end if;
  -- Une partie de 30 s plafonne a ~60 touches, x2 pendant le boss.
  if p_score > p_hits * 2 or p_score < -160 then
    raise exception 'inconsistent score';
  end if;
  if p_best_ms is not null and (p_best_ms < 90 or p_best_ms > 5000) then
    raise exception 'invalid best_ms';
  end if;
  if p_avg_ms is not null and (p_avg_ms < 90 or p_avg_ms > 5000) then
    raise exception 'invalid avg_ms';
  end if;

  -- Anti-spam : une partie dure 30 s, deux envois rapproches sont forcement du bruit.
  select max(created_at) into v_last
    from public.reflex_scores where player_id = v_pid;
  if v_last is not null and v_last > now() - interval '15 seconds' then
    raise exception 'too many submissions, wait a few seconds';
  end if;

  insert into public.reflex_scores
    (player_id, player_name, score, hits, misses, best_ms, avg_ms, mode, day)
  values
    (v_pid, v_name, p_score, p_hits, p_misses, p_best_ms, p_avg_ms, p_mode, v_day);

  with best as (
    select player_id, max(score) as sc
      from public.reflex_scores
     where day = v_day and mode = p_mode
     group by player_id
  )
  select (select sc from best where player_id = v_pid),
         (select count(*) from best),
         (select 1 + count(*) from best b
           where b.sc > (select sc from best where player_id = v_pid))
    into v_best, v_total, v_rank;

  return json_build_object(
    'ok',      true,
    'day',     v_day,
    'score',   p_score,
    'best',    v_best,
    'rank',    v_rank,
    'players', v_total
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Top du jour. is_me permet de surligner le joueur sans exposer les player_id.
-- ---------------------------------------------------------------------------
create or replace function public.reflex_leaderboard(
  p_mode      text default 'classic',
  p_limit     int  default 10,
  p_player_id text default null
) returns table (
  rank        int,
  player_name text,
  score       int,
  best_ms     int,
  is_me       boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with best as (
    select s.player_id,
           max(s.score)                                             as score,
           min(s.best_ms)                                           as best_ms,
           (array_agg(s.player_name order by s.created_at desc))[1]  as player_name
      from public.reflex_scores s
     where s.day = (now() at time zone 'Europe/Paris')::date
       and s.mode = coalesce(p_mode, 'classic')
     group by s.player_id
  )
  select (rank() over (order by b.score desc, b.best_ms asc nulls last))::int,
         b.player_name,
         b.score,
         b.best_ms,
         (p_player_id is not null and b.player_id = p_player_id)
    from best b
   order by b.score desc, b.best_ms asc nulls last
   limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

revoke all on function public.submit_reflex_score(text, text, int, int, int, int, int, text) from public;
revoke all on function public.reflex_leaderboard(text, int, text) from public;
grant execute on function public.submit_reflex_score(text, text, int, int, int, int, int, text) to anon, authenticated;
grant execute on function public.reflex_leaderboard(text, int, text) to anon, authenticated;
