-- ============================================================================
--  MaCinéthèque — MIGRATION V2
-- ============================================================================
--  À coller dans Supabase : « SQL Editor » → « New query » → coller → « Run ».
--
--  ✅ Ce script ne supprime et ne modifie AUCUNE de tes données : il ajoute
--     seulement des colonnes, deux tables et une règle sur les dates.
--  ✅ Il peut être relancé sans danger (tout est en « if not exists »).
--
--  Ce qu'il fait :
--   1. items   : nouvelles colonnes pour les suggestions (identifiant Wikidata,
--                réalisateurs, acteurs principaux) ;
--   2. ratings : confirme que note, commentaire et date sont tous facultatifs
--                à chaque niveau (série, saison, épisode) et interdit les dates
--                de visionnage dans le futur ;
--   3. nouvelle table dismissed_suggestions (suggestions « pas intéressé ») ;
--   4. nouvelle table suggestions_cache (suggestions gardées ~24 h) ;
--   5. droits + Row Level Security sur les nouvelles tables.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. items : informations utilisées par les suggestions
-- ----------------------------------------------------------------------------
alter table public.items add column if not exists wikidata_id text;                                -- ex. Q25188
alter table public.items add column if not exists directors   jsonb not null default '[]'::jsonb;  -- [{ "id": "Q25191", "name": "Christopher Nolan" }]
alter table public.items add column if not exists actors      jsonb not null default '[]'::jsonb;  -- acteurs principaux, même format
alter table public.items add column if not exists credits_at  timestamptz;                         -- date de la dernière recherche des infos ci-dessus

comment on column public.items.credits_at is
  'Vide = réalisateurs/acteurs pas encore recherchés (le site les complète tout seul).';


-- ----------------------------------------------------------------------------
-- 2. ratings : tout est facultatif, à chaque niveau
-- ----------------------------------------------------------------------------
--   Rappel du fonctionnement (inchangé) :
--     season vide,  episode vide  → la série (ou le film)
--     season = N,   episode vide  → la saison N
--     season = N,   episode = M   → l'épisode M de la saison N
--   Chaque ligne est indépendante : noter une saison ne crée, ne modifie et
--   n'efface aucune ligne d'épisode, et inversement.
--   Les trois lignes ci-dessous ne changent rien si c'est déjà le cas ; elles
--   garantissent que note, commentaire et date peuvent rester vides.
alter table public.ratings alter column rating     drop not null;
alter table public.ratings alter column comment    drop not null;
alter table public.ratings alter column watched_on drop not null;

-- Une date de visionnage ne peut pas être dans le futur (heure de Paris ;
-- un jour de marge pour les horloges mal réglées). Les lignes déjà
-- enregistrées ne sont pas touchées.
create or replace function public.check_watched_on()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.watched_on is not null
     and new.watched_on > (now() at time zone 'Europe/Paris')::date + 1 then
    raise exception 'La date de visionnage ne peut pas être dans le futur.'
      using errcode = '22008';
  end if;
  return new;
end;
$$;

revoke execute on function public.check_watched_on() from public, anon, authenticated;

drop trigger if exists ratings_check_watched_on on public.ratings;
create trigger ratings_check_watched_on
  before insert or update of watched_on on public.ratings
  for each row execute function public.check_watched_on();


-- ----------------------------------------------------------------------------
-- 3. dismissed_suggestions : les suggestions refusées (« pas intéressé »)
-- ----------------------------------------------------------------------------
create table if not exists public.dismissed_suggestions (
  user_id     uuid        not null default auth.uid()
                          references auth.users (id) on delete cascade,
  source      text        not null check (source in ('tvmaze', 'itunes', 'wikidata')),
  source_id   text        not null,
  type        text        not null check (type in ('film', 'serie')),
  title       text        not null,
  facets      jsonb       not null default '{}'::jsonb,  -- genres, réalisateurs… (léger signal négatif)
  created_at  timestamptz not null default now(),
  primary key (user_id, source, source_id)
);

comment on table public.dismissed_suggestions is
  'Suggestions que l''utilisateur a écartées : elles ne lui sont plus proposées.';


-- ----------------------------------------------------------------------------
-- 4. suggestions_cache : les suggestions calculées, gardées environ 24 h
-- ----------------------------------------------------------------------------
create table if not exists public.suggestions_cache (
  user_id       uuid        primary key default auth.uid()
                            references auth.users (id) on delete cascade,
  seeds_key     text        not null default '',  -- résumé des goûts ayant servi au calcul
  payload       jsonb       not null,             -- les œuvres candidates
  generated_at  timestamptz not null default now()
);

comment on table public.suggestions_cache is
  'Une ligne par utilisateur : ses suggestions du jour (ouverture rapide de la page « Pour toi »).';


-- ----------------------------------------------------------------------------
-- 5. Droits + Row Level Security : chacun ne voit que SES lignes
-- ----------------------------------------------------------------------------
revoke all on public.dismissed_suggestions, public.suggestions_cache from anon;
revoke all on public.dismissed_suggestions, public.suggestions_cache from authenticated;

grant select, insert, delete         on public.dismissed_suggestions to authenticated;
grant select, insert, update, delete on public.suggestions_cache     to authenticated;

alter table public.dismissed_suggestions enable row level security;
alter table public.suggestions_cache     enable row level security;

drop policy if exists "refus : lire les siens"      on public.dismissed_suggestions;
drop policy if exists "refus : ajouter les siens"   on public.dismissed_suggestions;
drop policy if exists "refus : supprimer les siens" on public.dismissed_suggestions;

create policy "refus : lire les siens" on public.dismissed_suggestions
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "refus : ajouter les siens" on public.dismissed_suggestions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "refus : supprimer les siens" on public.dismissed_suggestions
  for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "suggestions : lire les siennes"      on public.suggestions_cache;
drop policy if exists "suggestions : ajouter les siennes"   on public.suggestions_cache;
drop policy if exists "suggestions : modifier les siennes"  on public.suggestions_cache;
drop policy if exists "suggestions : supprimer les siennes" on public.suggestions_cache;

create policy "suggestions : lire les siennes" on public.suggestions_cache
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "suggestions : ajouter les siennes" on public.suggestions_cache
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "suggestions : modifier les siennes" on public.suggestions_cache
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "suggestions : supprimer les siennes" on public.suggestions_cache
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Prévient l'API de Supabase que la structure a changé (prise en compte immédiate).
notify pgrst, 'reload schema';

-- Fin. Résultat attendu : « Success. No rows returned ».
