-- Une seule ligne par joueur et par niveau : le MEILLEUR score.
-- Une partie qui n'ameliore rien n'ecrit pas -> beaucoup moins d'appels Supabase.
--
-- Consequence assumee : on ne conserve plus l'historique partie par partie.
-- `day` devient la date du record, plus une archive complete.

-- Deduplication avant la contrainte : on ne garde que la meilleure ligne
-- par (player_id, mode), departagee au meilleur temps de reaction.
delete from public.reflex_scores s
 where s.id not in (
   select distinct on (player_id, mode) id
     from public.reflex_scores
    order by player_id, mode, score desc, best_ms asc nulls last, created_at desc
 );

alter table public.reflex_scores
  drop constraint if exists reflex_scores_player_mode_key;
alter table public.reflex_scores
  add constraint reflex_scores_player_mode_key unique (player_id, mode);

comment on table public.reflex_scores is
  'Chicken Reflex : une ligne par joueur et par niveau = son MEILLEUR score. Ecrite uniquement quand le joueur bat son record (upsert conditionnel dans submit_reflex_score). day/created_at = date du record.';

-- ---------------------------------------------------------------------------
-- Upsert conditionnel : n'ecrit que si le score bat le record existant.
-- Renvoie improved=false quand rien n'a change.
-- ---------------------------------------------------------------------------
create or replace function public.submit_reflex_score(
  p_player_id   text,
  p_player_name text,
  p_score       int,
  p_hits        int,
  p_misses      int,
  p_best_ms     int,
  p_avg_ms      int,
  p_mode        text default 'easy'
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day       date := (now() at time zone 'Europe/Paris')::date;
  v_pid       text := nullif(btrim(p_player_id), '');
  v_name      text := left(coalesce(nullif(btrim(p_player_name), ''), 'Anon'), 24);
  v_old_score int;
  v_old_ms    int;
  v_improved  boolean;
  v_best      int;
  v_best_ms   int;
  v_rank      int;
  v_total     int;
begin
  -- Garde-fous : le client est public, on ne lui fait pas confiance.
  if v_pid is null or length(v_pid) > 64 then
    raise exception 'invalid player_id';
  end if;
  if p_mode is null or p_mode not in ('easy', 'medium', 'hard') then
    raise exception 'invalid mode';
  end if;
  if p_hits < 0 or p_hits > 80 or p_misses < 0 or p_misses > 80 then
    raise exception 'invalid counters';
  end if;
  -- La cible la plus riche (le Roi) vaut 5 points : au-dela, c'est truque.
  if p_score > p_hits * 5 or p_score < -160 then
    raise exception 'inconsistent score';
  end if;
  if p_best_ms is not null and (p_best_ms < 90 or p_best_ms > 5000) then
    raise exception 'invalid best_ms';
  end if;
  if p_avg_ms is not null and (p_avg_ms < 90 or p_avg_ms > 5000) then
    raise exception 'invalid avg_ms';
  end if;

  select score, best_ms into v_old_score, v_old_ms
    from public.reflex_scores where player_id = v_pid and mode = p_mode;

  -- Meilleur = score superieur, ou score egal avec un meilleur temps
  -- (c'est exactement la regle de departage du classement).
  v_improved := v_old_score is null
             or p_score > v_old_score
             or (p_score = v_old_score and p_best_ms is not null
                 and (v_old_ms is null or p_best_ms < v_old_ms));

  if v_improved then
    insert into public.reflex_scores
      (player_id, player_name, score, hits, misses, best_ms, avg_ms, mode, day, created_at)
    values
      (v_pid, v_name, p_score, p_hits, p_misses, p_best_ms, p_avg_ms, p_mode, v_day, now())
    on conflict (player_id, mode) do update
      set player_name = excluded.player_name,
          score       = excluded.score,
          hits        = excluded.hits,
          misses      = excluded.misses,
          best_ms     = excluded.best_ms,
          avg_ms      = excluded.avg_ms,
          day         = excluded.day,
          created_at  = excluded.created_at
      where excluded.score > public.reflex_scores.score
         or (excluded.score = public.reflex_scores.score
             and excluded.best_ms is not null
             and (public.reflex_scores.best_ms is null
                  or excluded.best_ms < public.reflex_scores.best_ms));
  else
    -- Pas de record, mais on garde le pseudo a jour sans toucher au score.
    update public.reflex_scores
       set player_name = v_name
     where player_id = v_pid and mode = p_mode and player_name is distinct from v_name;
  end if;

  with ranked as (
    select player_id, score, best_ms,
           rank() over (order by score desc, best_ms asc nulls last)::int as rank
      from public.reflex_scores where mode = p_mode
  )
  select r.score, r.best_ms, r.rank, (select count(*) from ranked)
    into v_best, v_best_ms, v_rank, v_total
    from ranked r where r.player_id = v_pid;

  return json_build_object(
    'ok',       true,
    'improved', v_improved,
    'score',    p_score,
    'best',     v_best,
    'best_ms',  v_best_ms,
    'rank',     v_rank,
    'players',  v_total
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Classement d'un niveau : TOP N + la ligne du joueur (meme hors du top).
-- Un seul appel pour toute la page classement.
-- ---------------------------------------------------------------------------
create or replace function public.reflex_board(
  p_mode      text default 'easy',
  p_limit     int  default 10,
  p_player_id text default null
) returns json
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select s.player_id, s.player_name, s.score, s.best_ms,
           rank() over (order by s.score desc, s.best_ms asc nulls last)::int as rank
      from public.reflex_scores s
     where s.mode = coalesce(p_mode, 'easy')
  ), topn as (
    select * from ranked
     order by rank, best_ms asc nulls last
     limit least(greatest(coalesce(p_limit, 10), 1), 50)
  )
  select json_build_object(
    'mode',    coalesce(p_mode, 'easy'),
    'players', (select count(*) from ranked),
    'top',     coalesce((select json_agg(json_build_object(
                           'rank',    t.rank,
                           'name',    t.player_name,
                           'score',   t.score,
                           'best_ms', t.best_ms,
                           'is_me',   (p_player_id is not null and t.player_id = p_player_id))
                           order by t.rank, t.best_ms asc nulls last)
                         from topn t), '[]'::json),
    'me',      (select json_build_object('rank', r.rank, 'name', r.player_name,
                                         'score', r.score, 'best_ms', r.best_ms)
                  from ranked r
                 where p_player_id is not null and r.player_id = p_player_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Les 3 niveaux d'un coup : champion + place du joueur.
-- Un seul appel au demarrage de l'application.
-- ---------------------------------------------------------------------------
create or replace function public.reflex_home(
  p_player_id text default null
) returns json
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select s.mode, s.player_id, s.player_name, s.score, s.best_ms,
           rank() over (partition by s.mode
                        order by s.score desc, s.best_ms asc nulls last)::int as rank
      from public.reflex_scores s
  )
  select json_object_agg(m.mode, json_build_object(
    'players', (select count(*) from ranked r where r.mode = m.mode),
    'top',     (select json_build_object('name', r.player_name, 'score', r.score, 'best_ms', r.best_ms)
                  from ranked r where r.mode = m.mode and r.rank = 1
                 order by r.best_ms asc nulls last limit 1),
    'me',      (select json_build_object('name', r.player_name, 'score', r.score,
                                         'best_ms', r.best_ms, 'rank', r.rank)
                  from ranked r
                 where r.mode = m.mode and p_player_id is not null and r.player_id = p_player_id)
  ))
  from (values ('easy'), ('medium'), ('hard')) as m(mode);
$$;

-- Remplacees par reflex_board / reflex_home.
drop function if exists public.reflex_leaderboard(text, int, text);
drop function if exists public.reflex_summary(text, text);

grant execute on function public.submit_reflex_score(text, text, int, int, int, int, int, text) to anon, authenticated;
grant execute on function public.reflex_board(text, int, text) to anon, authenticated;
grant execute on function public.reflex_home(text) to anon, authenticated;
