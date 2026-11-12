-- ============================================================================
--  MaCinéthèque — schéma Supabase complet (tables + sécurité RLS)
-- ============================================================================
--  À coller tel quel dans Supabase : menu « SQL Editor » → « New query » →
--  coller → bouton « Run ». Le script peut être relancé sans danger : il ne
--  supprime jamais de données.
--
--  Principe de sécurité : la « Row Level Security » (RLS) est activée sur
--  TOUTES les tables. Chaque ligne porte l'identifiant de son propriétaire
--  (user_id) et les règles n'autorisent un utilisateur connecté à lire ou
--  modifier que les lignes dont il est le propriétaire.
--  Seule exception : translations_cache, un simple cache de traductions
--  partagé (aucune donnée personnelle), en lecture + ajout uniquement.
--
--  Ce fichier contient le schéma COMPLET (version 2 comprise). Si ta base a
--  été créée avec la première version du site, colle plutôt
--  supabase/migration_v2.sql (plus court ; le résultat est le même).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Table « items » : les films et séries enregistrés par un utilisateur
-- ----------------------------------------------------------------------------
create table if not exists public.items (
  id               bigint generated always as identity primary key,
  user_id          uuid        not null default auth.uid()
                               references auth.users (id) on delete cascade,
  source           text        not null check (source in ('tvmaze', 'itunes', 'wikidata')),
  source_id        text        not null,                 -- identifiant chez la source
  type             text        not null check (type in ('film', 'serie')),
  title            text        not null,
  year             integer,
  countries        text[]      not null default '{}',    -- pays de production
  genres           text[]      not null default '{}',
  poster_url       text,                                 -- affiche (grande taille)
  summary_fr       text,                                 -- résumé en français
  summary_original text,                                 -- résumé d'origine (souvent en anglais)
  runtime          integer,                              -- durée en minutes (film, ou épisode moyen)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint items_unique_per_user unique (user_id, source, source_id)
);

comment on table public.items is
  'Films et séries enregistrés par chaque utilisateur (une copie par utilisateur).';


-- ----------------------------------------------------------------------------
-- 2. Table « ratings » : notes, commentaires et dates de visionnage
-- ----------------------------------------------------------------------------
--   season = NULL et episode = NULL  → le film, ou la série dans son ensemble
--   season = N    et episode = NULL  → la saison N
--   season = N    et episode = M     → l'épisode M de la saison N
--   rating peut être NULL : « vu mais pas encore noté ».
create table if not exists public.ratings (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null default auth.uid()
                          references auth.users (id) on delete cascade,
  item_id     bigint      not null references public.items (id) on delete cascade,
  season      integer     check (season is null or season >= 0),
  episode     integer     check (episode is null or episode >= 0),
  rating      smallint    check (rating is null or rating between 1 and 5),
  comment     text        check (comment is null or char_length(comment) <= 5000),
  watched_on  date,                                      -- date de visionnage
  runtime     integer,                                   -- durée de l'épisode en minutes (pour les stats)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- un épisode appartient forcément à une saison
  constraint ratings_episode_needs_season check (episode is null or season is not null),
  -- une seule ligne par (utilisateur, œuvre, saison, épisode), NULL compris
  constraint ratings_unique_target unique nulls not distinct (user_id, item_id, season, episode)
);

comment on table public.ratings is
  'Notes (1 à 5), commentaires et dates de visionnage : œuvre, saison ou épisode.';

create index if not exists ratings_item_idx on public.ratings (item_id);


-- ----------------------------------------------------------------------------
-- 3. Table « watchlist » : la liste « à voir »
-- ----------------------------------------------------------------------------
create table if not exists public.watchlist (
  user_id   uuid        not null default auth.uid()
                        references auth.users (id) on delete cascade,
  item_id   bigint      not null references public.items (id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (user_id, item_id)
);

comment on table public.watchlist is 'Œuvres que l''utilisateur veut voir plus tard.';

create index if not exists watchlist_item_idx on public.watchlist (item_id);


-- ----------------------------------------------------------------------------
-- 4. Table « translations_cache » : cache des traductions (partagé)
-- ----------------------------------------------------------------------------
--   hash = empreinte SHA-256 du texte original. Permet de ne jamais traduire
--   deux fois le même résumé. Ne contient aucune donnée personnelle.
create table if not exists public.translations_cache (
  hash        text        primary key check (char_length(hash) = 64),
  translated  text        not null check (char_length(translated) between 1 and 20000),
  created_at  timestamptz not null default now()
);

comment on table public.translations_cache is
  'Cache partagé : empreinte du texte original → traduction française.';


-- ----------------------------------------------------------------------------
-- 5. Mise à jour automatique de la colonne updated_at
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Cette fonction ne sert qu'aux déclencheurs ci-dessous : personne n'a besoin
-- de pouvoir l'appeler directement depuis l'API.
revoke execute on function public.set_updated_at() from public, anon, authenticated;

drop trigger if exists items_set_updated_at on public.items;
create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

drop trigger if exists ratings_set_updated_at on public.ratings;
create trigger ratings_set_updated_at
  before update on public.ratings
  for each row execute function public.set_updated_at();


-- ----------------------------------------------------------------------------
-- 6. Droits d'accès : uniquement les utilisateurs connectés
-- ----------------------------------------------------------------------------
--   « anon » = visiteur non connecté → aucun droit.
--   « authenticated » = utilisateur connecté → droits filtrés ensuite par la RLS.
revoke all on public.items, public.ratings, public.watchlist, public.translations_cache
  from anon;
revoke all on public.items, public.ratings, public.watchlist, public.translations_cache
  from authenticated;

grant select, insert, update, delete on public.items     to authenticated;
grant select, insert, update, delete on public.ratings   to authenticated;
grant select, insert, delete         on public.watchlist to authenticated;
grant select, insert                 on public.translations_cache to authenticated;


-- ----------------------------------------------------------------------------
-- 7. Row Level Security : chacun ne voit et ne modifie QUE ses données
-- ----------------------------------------------------------------------------
alter table public.items              enable row level security;
alter table public.ratings            enable row level security;
alter table public.watchlist          enable row level security;
alter table public.translations_cache enable row level security;

-- ---- items ----
drop policy if exists "items : lire les siens"      on public.items;
drop policy if exists "items : ajouter les siens"   on public.items;
drop policy if exists "items : modifier les siens"  on public.items;
drop policy if exists "items : supprimer les siens" on public.items;

create policy "items : lire les siens" on public.items
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "items : ajouter les siens" on public.items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "items : modifier les siens" on public.items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "items : supprimer les siens" on public.items
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---- ratings ----
drop policy if exists "ratings : lire les siennes"      on public.ratings;
drop policy if exists "ratings : ajouter les siennes"   on public.ratings;
drop policy if exists "ratings : modifier les siennes"  on public.ratings;
drop policy if exists "ratings : supprimer les siennes" on public.ratings;

create policy "ratings : lire les siennes" on public.ratings
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- On ne peut noter qu'une œuvre de SA propre liste d'items.
create policy "ratings : ajouter les siennes" on public.ratings
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.items i
      where i.id = item_id and i.user_id = (select auth.uid())
    )
  );

create policy "ratings : modifier les siennes" on public.ratings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.items i
      where i.id = item_id and i.user_id = (select auth.uid())
    )
  );

create policy "ratings : supprimer les siennes" on public.ratings
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---- watchlist ----
drop policy if exists "watchlist : lire la sienne"       on public.watchlist;
drop policy if exists "watchlist : ajouter à la sienne"  on public.watchlist;
drop policy if exists "watchlist : retirer de la sienne" on public.watchlist;

create policy "watchlist : lire la sienne" on public.watchlist
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "watchlist : ajouter à la sienne" on public.watchlist
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.items i
      where i.id = item_id and i.user_id = (select auth.uid())
    )
  );

create policy "watchlist : retirer de la sienne" on public.watchlist
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---- translations_cache (cache partagé : lecture + ajout, jamais de
--      modification ni de suppression) ----
drop policy if exists "cache : lecture pour les connectés" on public.translations_cache;
drop policy if exists "cache : ajout pour les connectés"   on public.translations_cache;

create policy "cache : lecture pour les connectés" on public.translations_cache
  for select to authenticated
  using (true);

create policy "cache : ajout pour les connectés" on public.translations_cache
  for insert to authenticated
  with check (true);


-- ============================================================================
--  COMPLÉMENTS DE LA VERSION 2 (suggestions « Pour toi », dates, etc.)
--  Identiques au fichier supabase/migration_v2.sql : si ta base date de la
--  première version, ce fichier-là suffit ; pour une installation neuve, tout
--  est déjà ici.
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


-- Fin du script. Résultat attendu dans Supabase : « Success. No rows returned ».
