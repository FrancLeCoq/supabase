-- Passage du classement quotidien a un CLASSEMENT GENERAL (all-time), un par
-- niveau (easy / medium / hard). La colonne `day` est conservee : elle archive
-- la date de chaque partie et permettra de rebrancher un classement quotidien
-- plus tard sans rien migrer.
--
-- Regle de classement inchangee : meilleur score par joueur, departage au
-- meilleur temps de reaction. Seule la fenetre change (tout l'historique).

-- L'index quotidien ne sert plus au tri principal : on indexe le general.
drop index if exists public.reflex_scores_board_idx;
create index if not exists reflex_scores_general_idx
  on public.reflex_scores (mode, score desc, best_ms asc);
create index if not exists reflex_scores_day_idx
  on public.reflex_scores (day, mode);

comment on table public.reflex_scores is
  'Parties du mini-jeu Chicken Reflex. Une ligne = une partie (archive complete). Le classement general prend le meilleur score par joueur et par niveau, departage au meilleur temps de reaction. La colonne day conserve la date (Europe/Paris) pour un futur classement quotidien.';

-- ---------------------------------------------------------------------------
-- Enregistre une partie et renvoie le rang GENERAL.
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
  v_day     date := (now() at time zone 'Europe/Paris')::date;
  v_pid     text := nullif(btrim(p_player_id), '');
  v_name    text := left(coalesce(nullif(btrim(p_player_name), ''), 'Anon'), 24);
  v_last    timestamptz;
  v_best    int;
  v_best_ms int;
  v_rank    int;
  v_total   int;
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

  -- Anti-spam : une partie dure 30 s, deux envois rapproches sont du bruit.
  select max(created_at) into v_last
    from public.reflex_scores where player_id = v_pid;
  if v_last is not null and v_last > now() - interval '15 seconds' then
    raise exception 'too many submissions, wait a few seconds';
  end if;

  insert into public.reflex_scores
    (player_id, player_name, score, hits, misses, best_ms, avg_ms, mode, day)
  values
    (v_pid, v_name, p_score, p_hits, p_misses, p_best_ms, p_avg_ms, p_mode, v_day);

  -- Classement general : meilleur score par joueur, sur tout l'historique.
  with best as (
    select player_id, max(score) as sc, min(best_ms) as ms
      from public.reflex_scores
     where mode = p_mode
     group by player_id
  ), me as (
    select sc, ms from best where player_id = v_pid
  )
  select (select sc from me),
         (select ms from me),
         (select count(*) from best),
         (select 1 + count(*) from best b, me
           where b.sc > me.sc or (b.sc = me.sc and b.ms < me.ms))
    into v_best, v_best_ms, v_total, v_rank;

  return json_build_object(
    'ok',      true,
    'day',     v_day,
    'score',   p_score,
    'best',    v_best,
    'best_ms', v_best_ms,
    'rank',    v_rank,
    'players', v_total
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Classement general d'un niveau. is_me surligne le joueur sans exposer d'id.
-- ---------------------------------------------------------------------------
create or replace function public.reflex_leaderboard(
  p_mode      text default 'easy',
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
           max(s.score)                                            as score,
           min(s.best_ms)                                          as best_ms,
           (array_agg(s.player_name order by s.created_at desc))[1] as player_name
      from public.reflex_scores s
     where s.mode = coalesce(p_mode, 'easy')
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

-- ---------------------------------------------------------------------------
-- Resume d'un niveau : le champion (medaille or) + le meilleur du joueur et
-- son rang. C'est ce qui s'affiche sous chaque mode easy / moyen / difficile.
-- Renvoie toujours une ligne, meme si le classement est vide.
-- ---------------------------------------------------------------------------
create or replace function public.reflex_summary(
  p_mode      text default 'easy',
  p_player_id text default null
) returns json
language sql
stable
security definer
set search_path = public
as $$
  with best as (
    select s.player_id,
           max(s.score)                                            as score,
           min(s.best_ms)                                          as best_ms,
           (array_agg(s.player_name order by s.created_at desc))[1] as player_name
      from public.reflex_scores s
     where s.mode = coalesce(p_mode, 'easy')
     group by s.player_id
  ), ranked as (
    select b.*, (rank() over (order by b.score desc, b.best_ms asc nulls last))::int as rank
      from best b
  )
  select json_build_object(
    'mode',    coalesce(p_mode, 'easy'),
    'players', (select count(*) from ranked),
    'top',     (select json_build_object('name', r.player_name, 'score', r.score, 'best_ms', r.best_ms)
                  from ranked r where r.rank = 1
                 order by r.best_ms asc nulls last limit 1),
    'me',      (select json_build_object('name', r.player_name, 'score', r.score,
                                         'best_ms', r.best_ms, 'rank', r.rank)
                  from ranked r where p_player_id is not null and r.player_id = p_player_id)
  );
$$;

grant execute on function public.submit_reflex_score(text, text, int, int, int, int, int, text) to anon, authenticated;
grant execute on function public.reflex_leaderboard(text, int, text) to anon, authenticated;
grant execute on function public.reflex_summary(text, text) to anon, authenticated;
