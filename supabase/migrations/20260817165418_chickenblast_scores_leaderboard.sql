-- ══════════════════════════════════════════════════════════════
--  Chicken Blast — classement mode Aventure
--  Une ligne par joueur : on ne garde QUE son meilleur score.
--  Ecriture reservee au service_role (RLS active, aucune policy)
--  via l'Edge Function chickenblast-scores.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.chickenblast_scores (
  player_id   text primary key,
  player_name text        not null default 'Anon',
  username    text,
  score       integer     not null default 0,   -- meilleurs $FRANC gagnes sur une partie
  levels      integer     not null default 0,   -- niveaux valides lors de ce meilleur run
  games       integer     not null default 0,   -- nombre de parties terminees
  best_at     timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

comment on table public.chickenblast_scores is
  'Classement Chicken Blast (mode Aventure). Une ligne par joueur, score = son meilleur run ($FRANC virtuels). Un nouveau run n''ecrase le score que s''il est strictement superieur. Acces via service_role uniquement (RLS active, aucune policy).';

alter table public.chickenblast_scores enable row level security;

-- classement : score desc, puis le record le plus ancien devant a egalite
create index if not exists chickenblast_scores_rank_idx
  on public.chickenblast_scores (score desc, best_at asc);

-- ── Soumission d'un run terminé ───────────────────────────────
-- Incremente toujours games ; n'ecrase score/levels/best_at que si
-- le nouveau score est STRICTEMENT superieur au meilleur stocke.
create or replace function public.chickenblast_submit_score(
  p_player_id text,
  p_name      text,
  p_username  text,
  p_score     integer,
  p_levels    integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev     integer;
  v_score    integer := greatest(coalesce(p_score, 0), 0);
  v_levels   integer := greatest(coalesce(p_levels, 0), 0);
begin
  if p_player_id is null or p_player_id = '' then
    raise exception 'player_id required';
  end if;

  select score into v_prev
    from chickenblast_scores
   where player_id = p_player_id;

  insert into chickenblast_scores
    (player_id, player_name, username, score, levels, games, best_at)
  values
    (p_player_id, coalesce(nullif(p_name, ''), 'Anon'), p_username, v_score, v_levels, 1, now())
  on conflict (player_id) do update set
    player_name = coalesce(nullif(excluded.player_name, ''), chickenblast_scores.player_name),
    username    = coalesce(excluded.username, chickenblast_scores.username),
    games       = chickenblast_scores.games + 1,
    score       = greatest(chickenblast_scores.score, excluded.score),
    levels      = case when excluded.score > chickenblast_scores.score
                       then excluded.levels else chickenblast_scores.levels end,
    best_at     = case when excluded.score > chickenblast_scores.score
                       then now() else chickenblast_scores.best_at end;

  return jsonb_build_object(
    'improved', (v_prev is null and v_score > 0) or (v_prev is not null and v_score > v_prev),
    'previous', v_prev,
    'best',     greatest(coalesce(v_prev, 0), v_score)
  );
end
$$;

-- ── Lecture du classement ─────────────────────────────────────
-- Renvoie le podium (p_limit) + la ligne du joueur avec son rang,
-- meme s'il est hors du podium, pour qu'il voie ou il se situe.
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
    select player_id, player_name, score, levels, best_at,
           row_number() over (order by score desc, best_at asc, player_id asc) as rk
      from chickenblast_scores
     where score > 0
  )
  select jsonb_build_object(
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name',  player_name,
               'score', score,
               'levels',levels,
               'rank',  rk,
               'me',    (p_player_id is not null and player_id = p_player_id)
             ) order by rk)
        from ranked
       where rk <= greatest(coalesce(p_limit, 3), 1)
    ), '[]'::jsonb),
    'me', (
      select jsonb_build_object(
               'name',  player_name,
               'score', score,
               'levels',levels,
               'rank',  rk
             )
        from ranked
       where p_player_id is not null and player_id = p_player_id
    ),
    'total', (select count(*) from ranked)
  )
$$;

revoke all on function public.chickenblast_submit_score(text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.chickenblast_leaderboard(text, integer) from public, anon, authenticated;
grant execute on function public.chickenblast_submit_score(text, text, text, integer, integer) to service_role;
grant execute on function public.chickenblast_leaderboard(text, integer) to service_role;
