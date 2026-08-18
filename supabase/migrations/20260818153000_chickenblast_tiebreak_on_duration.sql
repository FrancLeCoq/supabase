-- ══════════════════════════════════════════════════════════════
--  Chicken Blast — departage des ex aequo au temps
--  A $FRANC egaux, la partie la plus RAPIDE passe devant.
--  Les lignes existantes ont duration_ms NULL et sont donc classees
--  derriere les nouvelles a score egal (nulls last).
-- ══════════════════════════════════════════════════════════════

alter table public.chickenblast_scores
  add column if not exists duration_ms integer;

comment on column public.chickenblast_scores.duration_ms is
  'Duree totale du meilleur run, en millisecondes (somme des niveaux). Sert a departager les ex aequo : a score egal, le plus rapide devant. NULL sur les lignes anterieures a cette colonne.';

drop index if exists chickenblast_scores_rank_idx;
create index chickenblast_scores_rank_idx
  on public.chickenblast_scores (score desc, duration_ms asc nulls last, best_at asc);

-- L'ancienne signature a 5 arguments disparait au profit de celle a 6.
drop function if exists public.chickenblast_submit_score(text, text, text, integer, integer);

create or replace function public.chickenblast_submit_score(
  p_player_id   text,
  p_name        text,
  p_username    text,
  p_score       integer,
  p_levels      integer,
  p_duration_ms integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_score integer;
  v_prev_ms    integer;
  v_score      integer := greatest(coalesce(p_score, 0), 0);
  v_levels     integer := greatest(coalesce(p_levels, 0), 0);
  v_ms         integer := case when p_duration_ms is null or p_duration_ms < 0
                               then null else p_duration_ms end;
  v_better     boolean;
begin
  if p_player_id is null or p_player_id = '' then
    raise exception 'player_id required';
  end if;

  select score, duration_ms into v_prev_score, v_prev_ms
    from chickenblast_scores
   where player_id = p_player_id;

  -- Meilleur = plus de $FRANC, ou autant de $FRANC en moins de temps.
  v_better := v_prev_score is null
              or v_score > v_prev_score
              or (v_score = v_prev_score
                  and v_ms is not null
                  and (v_prev_ms is null or v_ms < v_prev_ms));

  insert into chickenblast_scores
    (player_id, player_name, username, score, levels, duration_ms, games, best_at)
  values
    (p_player_id, coalesce(nullif(p_name, ''), 'Anon'), p_username, v_score, v_levels, v_ms, 1, now())
  on conflict (player_id) do update set
    player_name = coalesce(nullif(excluded.player_name, ''), chickenblast_scores.player_name),
    username    = coalesce(excluded.username, chickenblast_scores.username),
    games       = chickenblast_scores.games + 1,
    score       = case when v_better then excluded.score       else chickenblast_scores.score       end,
    levels      = case when v_better then excluded.levels      else chickenblast_scores.levels      end,
    duration_ms = case when v_better then excluded.duration_ms else chickenblast_scores.duration_ms end,
    best_at     = case when v_better then now()                else chickenblast_scores.best_at     end;

  return jsonb_build_object(
    'improved',    v_better and v_score > 0,
    'previous',    v_prev_score,
    'previous_ms', v_prev_ms
  );
end
$$;

create or replace function public.chickenblast_leaderboard(
  p_player_id text default null,
  p_limit     integer default 3
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select player_id, player_name, score, levels, duration_ms, best_at,
           row_number() over (
             order by score desc, duration_ms asc nulls last, best_at asc, player_id asc
           ) as rk
      from chickenblast_scores
     where score > 0
  )
  select jsonb_build_object(
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name',   player_name,
               'score',  score,
               'levels', levels,
               'ms',     duration_ms,
               'rank',   rk,
               'me',     (p_player_id is not null and player_id = p_player_id)
             ) order by rk)
        from ranked
       where rk <= greatest(coalesce(p_limit, 3), 1)
    ), '[]'::jsonb),
    'me', (
      select jsonb_build_object(
               'name',   player_name,
               'score',  score,
               'levels', levels,
               'ms',     duration_ms,
               'rank',   rk
             )
        from ranked
       where p_player_id is not null and player_id = p_player_id
    ),
    'total', (select count(*) from ranked)
  )
$$;

revoke all on function public.chickenblast_submit_score(text, text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.chickenblast_leaderboard(text, integer) from public, anon, authenticated;
grant execute on function public.chickenblast_submit_score(text, text, text, integer, integer, integer) to service_role;
grant execute on function public.chickenblast_leaderboard(text, integer) to service_role;
