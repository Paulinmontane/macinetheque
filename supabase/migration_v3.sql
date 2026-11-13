-- ============================================================================
--  MaCinéthèque — MIGRATION V3
-- ============================================================================
--  À coller dans Supabase : « SQL Editor » → « New query » (ou « Create a new
--  snippet ») → coller → « Run ».
--
--  ✅ Ce script ne supprime et ne modifie AUCUNE de tes données : il ajoute
--     seulement des colonnes et quatre tables.
--  ✅ Il peut être relancé sans danger (tout est en « if not exists »).
--  ⚠️ Il suppose que la migration V2 (migration_v2.sql) a déjà été appliquée.
--
--  Ce qu'il fait :
--   1. items : durées des épisodes de chaque saison (pour le temps de
--      visionnage) et dates de dernière vérification ;
--   2. people + item_cast : les acteurs principaux de chaque film / série,
--      PARTAGÉS entre tous les comptes (en lecture et en ajout seulement :
--      personne ne peut modifier ni effacer ce qu'un autre a ajouté) ;
--   3. recaps : les récaps mensuels et annuels déjà calculés ;
--   4. user_settings : le thème de couleurs, pour le retrouver sur tous
--      tes appareils ;
--   5. droits + Row Level Security sur toutes les nouvelles tables.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. items : durées détaillées
-- ----------------------------------------------------------------------------
--   seasons_meta (séries) : pour chaque saison, la liste des épisodes et leur
--   durée en minutes, ex. {"1": [[1, 58], [2, 48], [3, null]]}.
--   Sert à compter une saison « marquée vue » ou notée sans ses épisodes.
alter table public.items add column if not exists seasons_meta jsonb;
alter table public.items add column if not exists meta_at      timestamptz;  -- durées vérifiées le…
alter table public.items add column if not exists cast_at      timestamptz;  -- acteurs recherchés le…

comment on column public.items.seasons_meta is
  'Séries : {"saison": [[épisode, durée en minutes ou null], …]}. Vide = pas encore recherché.';


-- ----------------------------------------------------------------------------
-- 2. people + item_cast : acteurs principaux (données partagées)
-- ----------------------------------------------------------------------------
--   Une même œuvre a les mêmes acteurs pour tout le monde : on les stocke une
--   seule fois. Identifiants :
--     people.id      : « Q38111 » (Wikidata, acteurs de films)
--                      ou « tm14245 » (TVMaze, acteurs de séries)
--     item_cast.work : « wd:Q25188 » (film, identifiant Wikidata)
--                      ou « tm:169 » (série, identifiant TVMaze)
create table if not exists public.people (
  id          text        primary key check (id ~ '^(Q|tm)[0-9]+$'),
  name        text        not null check (char_length(name) between 1 and 300),
  photo_url   text        check (photo_url is null or photo_url ~ '^https://'),
  created_at  timestamptz not null default now()
);

create table if not exists public.item_cast (
  work        text        not null check (work ~ '^(wd:Q|tm:)[0-9]+$'),
  person_id   text        not null references public.people (id) on delete cascade,
  ord         smallint    not null default 0 check (ord between 0 and 99),  -- 0 = rôle le plus important
  created_at  timestamptz not null default now(),
  primary key (work, person_id)
);

create index if not exists item_cast_person_idx on public.item_cast (person_id);

comment on table public.people    is 'Acteurs (partagés entre tous les comptes).';
comment on table public.item_cast is 'Acteurs principaux de chaque film / série (partagés).';


-- ----------------------------------------------------------------------------
-- 3. recaps : récaps mensuels et annuels déjà calculés
-- ----------------------------------------------------------------------------
create table if not exists public.recaps (
  user_id       uuid        not null default auth.uid()
                            references auth.users (id) on delete cascade,
  kind          text        not null check (kind in ('month', 'year')),
  period        text        not null check (period ~ '^[0-9]{4}(-[0-9]{2})?$'),  -- « 2026-10 » ou « 2026 »
  data          jsonb       not null,
  signature     text        not null default '',  -- empreinte des notes utilisées (recalcul si elles changent)
  generated_at  timestamptz not null default now(),
  seen_at       timestamptz,                      -- vide = récap pas encore ouvert (bannière « prêt »)
  primary key (user_id, kind, period)
);

comment on table public.recaps is 'Récaps mensuels / annuels de chaque utilisateur.';


-- ----------------------------------------------------------------------------
-- 4. user_settings : réglages (thème de couleurs)
-- ----------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id     uuid        primary key default auth.uid()
                          references auth.users (id) on delete cascade,
  theme       jsonb       not null default '{}'::jsonb,  -- {"preset": "givre", "accent": "#9abae6", "mode": "dark"}
  updated_at  timestamptz not null default now()
);

comment on table public.user_settings is 'Réglages de chaque utilisateur (thème de couleurs).';

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();


-- ----------------------------------------------------------------------------
-- 5. Droits + Row Level Security
-- ----------------------------------------------------------------------------
revoke all on public.people, public.item_cast, public.recaps, public.user_settings from anon;
revoke all on public.people, public.item_cast, public.recaps, public.user_settings from authenticated;

grant select, insert                 on public.people        to authenticated;
grant select, insert                 on public.item_cast     to authenticated;
grant select, insert, update, delete on public.recaps        to authenticated;
grant select, insert, update         on public.user_settings to authenticated;

alter table public.people        enable row level security;
alter table public.item_cast     enable row level security;
alter table public.recaps        enable row level security;
alter table public.user_settings enable row level security;

-- ---- people / item_cast : partagés — lecture et ajout pour les comptes
--      connectés ; aucune modification ni suppression possible.
drop policy if exists "acteurs : lecture pour les connectés" on public.people;
drop policy if exists "acteurs : ajout pour les connectés"   on public.people;
create policy "acteurs : lecture pour les connectés" on public.people
  for select to authenticated using (true);
create policy "acteurs : ajout pour les connectés" on public.people
  for insert to authenticated with check (true);

drop policy if exists "distribution : lecture pour les connectés" on public.item_cast;
drop policy if exists "distribution : ajout pour les connectés"   on public.item_cast;
create policy "distribution : lecture pour les connectés" on public.item_cast
  for select to authenticated using (true);
create policy "distribution : ajout pour les connectés" on public.item_cast
  for insert to authenticated with check (true);

-- ---- recaps : chacun ne voit et ne modifie que les siens
drop policy if exists "récaps : lire les siens"      on public.recaps;
drop policy if exists "récaps : ajouter les siens"   on public.recaps;
drop policy if exists "récaps : modifier les siens"  on public.recaps;
drop policy if exists "récaps : supprimer les siens" on public.recaps;
create policy "récaps : lire les siens" on public.recaps
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "récaps : ajouter les siens" on public.recaps
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "récaps : modifier les siens" on public.recaps
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "récaps : supprimer les siens" on public.recaps
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---- user_settings : chacun ne voit et ne modifie que les siens
drop policy if exists "réglages : lire les siens"     on public.user_settings;
drop policy if exists "réglages : ajouter les siens"  on public.user_settings;
drop policy if exists "réglages : modifier les siens" on public.user_settings;
create policy "réglages : lire les siens" on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "réglages : ajouter les siens" on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "réglages : modifier les siens" on public.user_settings
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Prévient l'API de Supabase que la structure a changé (prise en compte immédiate).
notify pgrst, 'reload schema';

-- Fin. Résultat attendu : « Success. No rows returned ».
