# MaCinéthèque

Un site personnel pour **noter les films et les séries que tu regardes** : recherche avec autocomplétion, notes de 1 à 5 étoiles (films, séries, saisons, épisodes), commentaires, dates de visionnage, liste « à voir », suggestions, statistiques détaillées (temps de visionnage par jour, semaine, mois ou année, acteurs), récaps du mois et de l'année, thèmes de couleurs, import de l'historique Netflix et Prime Video. Il fonctionne sur ordinateur comme sur iPhone, où il s'installe comme une application.

- **Site** : HTML / CSS / JavaScript simples, sans étape de fabrication → hébergé gratuitement sur **GitHub Pages**.
- **Comptes et données** : **Supabase** (offre gratuite). Chaque utilisateur ne voit et ne modifie que ses propres données.
- **Films et séries** : API gratuites, sans clé ni compte (TVMaze, iTunes, Wikidata/Wikipédia, MyMemory pour la traduction).

> **Ce qu'il te faut** : un ordinateur, une adresse email, et environ 20 minutes. Tu vas créer deux comptes gratuits (Supabase et GitHub). Aucune carte bancaire.

## Sommaire

1. [Créer le projet Supabase](#étape-1--créer-le-projet-supabase)
2. [Coller le SQL (tables + sécurité)](#étape-2--coller-le-sql-tables--sécurité)
3. [Récupérer l'URL et la clé, remplir `config.js`](#étape-3--récupérer-lurl-et-la-clé-puis-remplir-configjs)
4. [Mettre le site en ligne avec GitHub Pages](#étape-4--mettre-le-site-en-ligne-avec-github-pages)
5. [Indiquer l'adresse du site à Supabase](#étape-5--indiquer-ladresse-du-site-à-supabase-liens-des-emails)
6. [Créer ton compte sur le site](#étape-6--créer-ton-compte-sur-le-site)
7. [Installer le site sur l'iPhone](#étape-7--installer-le-site-sur-lécran-daccueil-de-liphone)

Tu avais déjà installé une version précédente ? Va directement à [Passer à la version 2](#passer-à-la-version-2) puis à [Passer à la version 3](#passer-à-la-version-3).

Puis : [utilisation](#utilisation), [modifier le site](#modifier-le-site-plus-tard), [dépannage](#dépannage), [comment c'est fait](#comment-cest-fait), [limites à connaître](#limites-à-connaître), [tests réalisés](#tests-réalisés).

---

## Étape 1 — Créer le projet Supabase

Supabase gère les comptes (email + mot de passe) et stocke tes notes.

1. Va sur **https://supabase.com** et clique sur **Start your project**.
2. Crée ton compte. **Utilise l'adresse email avec laquelle tu te connecteras ensuite à MaCinéthèque** (c'est important pour recevoir l'email de confirmation — voir l'étape 6).
3. Supabase te demande de créer une **organisation** : mets ton prénom, laisse le type « Personal » et le plan **Free**.
4. Clique sur **New project** et remplis :
   - **Project name** : `macinetheque`
   - **Database password** : clique sur **Generate a password**, puis copie-le dans un endroit sûr. (Le site n'en a pas besoin, mais garde-le.)
   - **Region** : choisis une région en Europe (par exemple *West EU* ou *Central EU*).
5. Clique sur **Create new project** et patiente une à deux minutes, le temps que le projet démarre.

## Étape 2 — Coller le SQL (tables + sécurité)

Ce script crée les 4 tables et active les règles de sécurité (RLS) qui séparent les données de chaque utilisateur.

1. Dans le menu de gauche de Supabase, clique sur **SQL Editor**.
2. Clique sur **New query** (ou sur le **+**).
3. Ouvre le fichier [`supabase/schema.sql`](supabase/schema.sql) de ce dossier avec un éditeur de texte (Bloc-notes, TextEdit…), **sélectionne tout** (Ctrl+A), **copie** (Ctrl+C).
4. **Colle** (Ctrl+V) dans l'éditeur de Supabase.
5. Clique sur **Run** (en bas à droite), ou fais Ctrl+Entrée.
   - Si une fenêtre d'avertissement apparaît (« destructive operation »…), c'est normal : le script contient des lignes `drop … if exists` pour pouvoir être relancé sans erreur. Confirme avec **Run this query**.
6. Tu dois voir : **Success. No rows returned**.
7. Vérifie : dans le menu de gauche, **Table Editor** doit maintenant afficher 4 tables — `items`, `ratings`, `watchlist`, `translations_cache`.

> Tu peux relancer ce script autant de fois que tu veux : il ne supprime jamais de données.

## Étape 3 — Récupérer l'URL et la clé, puis remplir `config.js`

Le site a besoin de deux informations pour parler à **ton** projet Supabase.

1. En haut de la page de ton projet Supabase, clique sur le bouton **Connect**. La fenêtre affiche :
   - l'**URL du projet**, de la forme `https://abcdefghijklmnop.supabase.co` ;
   - la **Publishable key**, qui commence par `sb_publishable_…`.

   *Autre chemin, si tu ne trouves pas le bouton :* roue dentée **Project Settings** → **API Keys** pour la clé (crée-la avec le bouton proposé si la liste est vide), et **Project Settings** → **Data API** pour l'URL.
2. Ouvre le fichier **`js/config.js`** de ce dossier avec un éditeur de texte.
3. Remplace les deux valeurs entre apostrophes, **en gardant les apostrophes** :

   ```js
   export const SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co';
   export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxx';
   ```

4. Enregistre le fichier.

> **À propos de la « clé anon »** : c'est l'ancien nom de la *publishable key*. Supabase a annoncé le retrait des anciennes clés `anon` (celles qui commencent par `eyJ…`) pour fin 2026 : utilise donc la clé `sb_publishable_…`. Les deux fonctionnent avec ce site.
>
> ✅ Cette clé est **faite pour être publique** : elle peut rester dans le code, visible de tous. Ce sont les règles RLS de l'étape 2 qui protègent les données.
> ⛔ Ne mets **jamais** dans ce fichier une clé **secret** (`sb_secret_…`) ou **service_role** : elles donnent tous les droits sur ta base.

## Étape 4 — Mettre le site en ligne avec GitHub Pages

### 4.1 Créer ton compte et ton dépôt

1. Va sur **https://github.com** et crée un compte (**Sign up**). Ton **pseudo** apparaîtra dans l'adresse du site : choisis-le bien.
2. Une fois connecté, clique sur le **+** en haut à droite → **New repository**.
3. Remplis :
   - **Repository name** : `macinetheque`
   - Visibilité : **Public** (obligatoire pour GitHub Pages gratuit)
   - Ne coche **aucune** case (pas de README, pas de .gitignore).
4. Clique sur **Create repository**.

### 4.2 Envoyer les fichiers

1. Sur la page du dépôt vide, clique sur le lien **uploading an existing file**.
   (Si le dépôt n'est plus vide : bouton **Add file** → **Upload files**.)
2. Sur ton ordinateur, ouvre le dossier `macinetheque`, **sélectionne tout ce qu'il contient** (Ctrl+A) et **fais glisser le tout** dans la page GitHub :

   ```
   index.html   manifest.webmanifest   sw.js   README.md
   css/   icons/   js/   lib/   supabase/
   ```

   ⚠️ Glisse le **contenu** du dossier, pas le dossier lui-même : `index.html` doit se retrouver à la racine du dépôt.
3. Attends la fin de l'envoi (33 fichiers), puis clique sur le bouton vert **Commit changes**.

### 4.3 Activer GitHub Pages

1. Dans ton dépôt, clique sur l'onglet **Settings** (tout à droite ; s'il est caché, ouvre le menu **…**).
2. Dans la colonne de gauche, clique sur **Pages**.
3. Sous **Build and deployment** → **Source**, choisis **Deploy from a branch**.
4. Sous **Branch**, choisis **main** et le dossier **/ (root)**, puis clique sur **Save**.
5. Patiente une à deux minutes (jusqu'à 10 la première fois), puis recharge la page : un encadré indique **Your site is live at…** avec un bouton **Visit site**.

### 4.4 L'adresse de ton site

```
https://<ton-pseudo>.github.io/macinetheque/
```

Exemple : si ton pseudo GitHub est `leo-cine`, ton site est à l'adresse `https://leo-cine.github.io/macinetheque/`. **Note cette adresse**, tu en as besoin à l'étape suivante.

<details>
<summary>Variante pour ceux qui connaissent Git (ligne de commande)</summary>

```bash
cd macinetheque
```

```bash
git init -b main
```

```bash
git add .
```

```bash
git commit -m "MaCinéthèque"
```

```bash
git remote add origin https://github.com/<ton-pseudo>/macinetheque.git
```

```bash
git push -u origin main
```

Puis active GitHub Pages comme en 4.3.
</details>

## Étape 5 — Indiquer l'adresse du site à Supabase (liens des emails)

Les emails de **confirmation d'inscription** et de **mot de passe oublié** contiennent un lien qui doit te ramener sur ton site. Par défaut, Supabase renvoie vers `http://localhost:3000`, ce qui ne marche pas : il faut lui donner ta vraie adresse.

1. Dans Supabase, menu de gauche : **Authentication** → **URL Configuration**.
2. Dans **Site URL**, remplace le contenu par l'adresse de ton site, **avec le `/` final** :

   ```
   https://<ton-pseudo>.github.io/macinetheque/
   ```

   Enregistre (bouton **Save**).
3. Dans **Redirect URLs**, clique sur **Add URL** et ajoute ces deux lignes :

   ```
   https://<ton-pseudo>.github.io/macinetheque/
   ```

   ```
   https://<ton-pseudo>.github.io/macinetheque/**
   ```

   Enregistre.

## Étape 6 — Créer ton compte sur le site

1. Ouvre `https://<ton-pseudo>.github.io/macinetheque/`.
2. Clique sur **Créer un compte**, saisis **la même adresse email que ton compte Supabase** et un mot de passe (6 caractères minimum).
3. Ouvre l'email de confirmation envoyé par Supabase (en anglais ; regarde aussi dans les indésirables) et clique sur le lien : tu arrives sur le site, connecté.
4. Cherche un film, ouvre sa fiche, clique sur les étoiles. C'est parti.

### ⚠️ À savoir sur les emails de Supabase (offre gratuite)

Le service d'email fourni d'office par Supabase est volontairement limité :

- il n'envoie des emails **qu'aux adresses des membres de ton projet Supabase** (donc la tienne) — une autre adresse reçoit l'erreur « Email address not authorized » ;
- il est limité à **2 emails par heure**.

Pour toi tout seul, cela suffit. **Si tu veux que des amis créent aussi un compte**, le plus simple :

1. Supabase → **Authentication** → **Sign In / Providers** (ou **Providers**) → **Email**.
2. Désactive **Confirm email**, puis **Save**.

Les comptes sont alors créés sans email de confirmation. En contrepartie, le « mot de passe oublié » ne fonctionnera que pour ton adresse à toi. (Pour lever ces limites, il faudrait brancher ton propre service d'envoi d'emails — réglage « SMTP » de la partie Authentication ; cela demande un compte supplémentaire et n'est pas nécessaire pour un usage personnel.)

## Étape 7 — Installer le site sur l'écran d'accueil de l'iPhone

1. Sur l'iPhone, ouvre **Safari** et va sur `https://<ton-pseudo>.github.io/macinetheque/`.
2. Touche le bouton **Partager** (le carré avec une flèche vers le haut).
3. Fais défiler et touche **Sur l'écran d'accueil**.
4. Touche **Ajouter**.
5. L'icône **MaCinéthèque** (une petite caméra ambre) apparaît sur l'écran d'accueil. Ouvre le site depuis cette icône : il s'affiche en plein écran, comme une application, avec la barre de navigation en bas.
6. Connecte-toi une fois : tu restes connecté ensuite.

*Sur Android (Chrome) : menu ⋮ → **Ajouter à l'écran d'accueil** / **Installer l'application**. Sur ordinateur (Chrome, Edge) : icône d'installation dans la barre d'adresse.*

---

## Passer à la version 2

La version 2 ajoute la page **Pour toi** (suggestions), la notation libre des séries (série, saison ou épisode, au choix), le sélecteur de date, la confirmation en grand et le nouveau logo.

**Une seule chose à faire : coller un script SQL dans Supabase.** Il n'efface et ne modifie aucune de tes notes.

1. Ouvre ce fichier : [`supabase/migration_v2.sql`](supabase/migration_v2.sql). Sur GitHub, clique sur l'icône **Copy raw file** (deux petits carrés, en haut à droite du code).
2. Dans Supabase, menu de gauche : **SQL Editor** → **New query**.
3. Colle (Ctrl+V), puis clique sur **Run**.
4. Si un avertissement apparaît (« destructive operation »), confirme : le script contient des lignes `drop … if exists` pour pouvoir être relancé sans erreur.
5. Tu dois lire **Success. No rows returned**.
6. Recharge le site. L'onglet **Pour toi** affiche maintenant des suggestions.

Tant que ce script n'est pas collé, le site fonctionne comme avant ; seule la page **Pour toi** affiche un message d'attente. Tu peux relancer le script autant de fois que tu veux.

**Pour vérifier que tout va bien :**
- **Ma collection** montre toujours toutes tes œuvres, avec les mêmes notes.
- Dans Supabase → **Table Editor**, il y a deux nouvelles tables : `dismissed_suggestions` et `suggestions_cache`.
- La nouvelle icône (caméra) n'apparaît pas sur l'iPhone ? Supprime l'ancienne icône de l'écran d'accueil et ajoute le site à nouveau (étape 7).

## Passer à la version 3

La version 3 ajoute le **temps de visionnage** (par jour, mois, année ou depuis toujours), les **acteurs** les plus regardés et préférés, la page **Récaps** (récap du mois et de l'année en plein écran, image à partager) et la page **Réglages** (thème « Bleu givré » par défaut, 10 thèmes, couleur personnalisée, mode clair / sombre / automatique).

**Une seule chose à faire : coller un script SQL dans Supabase.** Il n'efface et ne modifie aucune de tes notes (il ajoute seulement des colonnes et quatre tables). La version 2 doit déjà être en place.

1. Ouvre ce fichier : [`supabase/migration_v3.sql`](supabase/migration_v3.sql). Sur GitHub, clique sur l'icône **Copy raw file** (deux petits carrés, en haut à droite du code).
2. Dans Supabase, menu de gauche : **SQL Editor**, puis le bouton **+** / **New query** → **Create a new snippet**.
3. Colle (Ctrl+V), puis clique sur **Run**.
4. Tu dois lire **Success. No rows returned**.
5. Recharge le site (deux fois si besoin, ou ferme et rouvre l'application sur l'iPhone).

Tant que ce script n'est pas collé, le site fonctionne : les statistiques de temps et le thème marchent déjà (le thème reste alors sur l'appareil), seules les pages **Récaps** et la partie **Acteurs** affichent un message d'attente. Le script peut être relancé sans danger.

**Pour vérifier que tout va bien :**
- **Ma collection** montre toujours toutes tes œuvres, avec les mêmes notes.
- Dans Supabase → **Table Editor**, il y a quatre nouvelles tables : `people`, `item_cast`, `recaps` et `user_settings`.
- Page **Stats** : la première ouverture complète les durées et les acteurs de tes œuvres (une barre de progression l'indique, quelques dizaines de secondes) ; ensuite tout est immédiat.
- Choisis un thème dans **Réglages** (engrenage en haut à droite) puis ouvre le site sur un autre appareil : après connexion, le même thème s'affiche.

## Utilisation

| Action | Comment |
|---|---|
| Chercher une œuvre | Tape au moins 2 lettres dans la barre de recherche : films et séries sont proposés ensemble, avec un badge **Film** / **Série**. |
| Compléter le titre | Le texte grisé propose le titre le plus probable : **Tab** ou **→** pour l'accepter (sur téléphone : touche la petite flèche). |
| Naviguer au clavier | **↑ ↓** pour parcourir, **Entrée** pour ouvrir, **Échap** pour fermer. **Entrée** sans sélection affiche tous les résultats. |
| Noter | Clique sur les étoiles : un grand écran « Note enregistrée » confirme. Note, commentaire et date sont tous facultatifs. |
| Série | Note ce que tu veux, sans obligation : la série entière, une saison entière, quelques épisodes, ou tout à la fois. Chaque note est indépendante. La pastille ronde marque un épisode comme vu ; l'icône bulle ouvre commentaire et date. |
| Moyenne indicative | Une saison sans note mais avec des épisodes notés affiche en gris la moyenne de ces épisodes (« moy. épisodes 4,0 »). Même principe pour la série à partir des saisons. Ce n'est jamais enregistré comme une note. |
| Date de visionnage | Rien à taper : **Aujourd'hui** (par défaut), **Hier**, **Choisir une date…** (calendrier) ou **Date inconnue**. Les dates futures sont refusées. |
| Toute une saison vue | Bouton **Marquer toute la saison comme vue** : enregistre la date choisie pour chaque épisode, sans imposer de note, sans toucher aux notes déjà données. |
| Liste à voir | Bouton **Ajouter à ma liste à voir** sur une fiche. Dans la page **À voir**, **J'ai vu** fait passer l'œuvre dans la collection et ouvre sa fiche pour la noter. |
| Modifier / supprimer | Reclique sur les étoiles pour changer la note ; **Retirer la note** enlève seulement les étoiles ; **Tout supprimer** efface note, commentaire et date de ce niveau. |
| Pour toi | Des films et des séries proposés d'après tes notes, avec la raison (« Parce que tu as aimé *Inception* (même réalisateur) »). Sur chaque carte : **Déjà vu → noter**, **À voir**, **Pas intéressé**. Filtres Films / Séries / genre, bouton **Rafraîchir**. |
| Mot de passe | L'icône œil affiche ou masque ce que tu tapes. |
| Mot de passe oublié | Sur l'écran de connexion, **Mot de passe oublié ?** : tu reçois un lien par email pour en choisir un nouveau. |
| Email oublié | Sur l'écran de connexion, **Email oublié ?** : le site affiche les adresses déjà utilisées pour se connecter sur cet appareil (un appui la reprend) et explique où retrouver la bonne. Ces adresses restent dans le navigateur, elles ne sont envoyées nulle part. En tant que propriétaire du site, tu peux aussi voir tous les comptes dans Supabase → **Authentication** → **Users**. |
| Résumés | Les résumés en anglais sont traduits automatiquement ; **voir l'original** affiche le texte d'origine. |
| Sauvegarde | Page **Compte** → **Exporter mes données** télécharge toutes tes notes dans un fichier. |
| Temps de visionnage | Page **Stats** : choisis **Jour**, **Semaine** (du lundi au dimanche), **Mois**, **Année** ou **Depuis toujours** (« Toujours » sur téléphone), change de période avec **‹ ›** ou en touchant la date (calendrier ou liste, rien à taper). Tous les chiffres de la page (films, séries, saisons, épisodes, genres, pays, notes, acteurs) suivent la période choisie. |
| Comment le temps est compté | Chaque film ou épisode compte à sa date de visionnage ; « date inconnue » ne compte que dans « Depuis toujours ». Sans durée connue : 110 min pour un film, 45 min pour un épisode (« durée estimée »). Une saison notée ou marquée vue sans ses épisodes compte tous ses épisodes à la date de la saison, sans jamais compter deux fois un épisode noté à part. Une note donnée à la série entière seule n'ajoute pas de temps. |
| Acteurs | Page **Stats**, en bas : **le plus regardé** (au temps passé, puis au nombre d'œuvres) et **le préféré** (meilleure moyenne, au moins 2 œuvres notées). Filtre **Films / Séries / Les deux**. Touche un acteur pour voir ses œuvres que tu as vues. |
| Récaps | Le récap d'un mois arrive le 1er du mois suivant ; celui de l'année, « en cours » dès le 1er décembre puis définitif le 1er janvier. Une bannière sur l'accueil prévient. Touche à droite (ou glisse) pour avancer, à gauche pour revenir, ✕ pour fermer. Le dernier écran propose **Partager** : une image 1080 × 1920 pour le menu de partage de l'iPhone (ou téléchargée sur ordinateur). |
| Importer Netflix | Page **Compte** → **Importer Netflix / Prime Video**. Sur [netflix.com/viewingactivity](https://www.netflix.com/viewingactivity) (dans le navigateur, pas l'application), choisis ton profil puis **Télécharger tout** en bas de la liste ; choisis ce fichier `NetflixViewingHistory.csv` sur le site. |
| Importer Prime Video | Sur ordinateur : fais glisser le bouton **📥 Copier mon historique Prime** dans ta barre de favoris, ouvre [ton historique Prime Video](https://www.primevideo.com/settings/watch-history), clique le favori (la page défile toute seule et l'historique est copié), puis colle-le sur le site. Sur iPhone : sélectionne tout le texte de la page d'historique, copie, colle. Un fichier de données demandé à Amazon marche aussi. |
| Après le choix du fichier | Le site retrouve chaque film et série (les titres français sont reconnus). Ce qui est sûr est coché ; ce qui est « à vérifier » ne l'est pas : coche-le ou choisis la bonne œuvre dans la liste. **Importer** ajoute tout comme « vu », sans note, à la date du visionnage. Tes notes, commentaires et dates existants ne sont jamais modifiés (seule une date « inconnue » est complétée), et réimporter le même fichier ne crée pas de doublon. |
| Couleurs | **Réglages** (engrenage en haut à droite, ou page **Compte**) : 10 thèmes, une couleur personnalisée (roue de couleur ou code), mode **Sombre / Clair / Automatique**, **Réinitialiser**. Le choix suit ton compte sur tous tes appareils. L'icône de l'application sur l'iPhone reste en Bleu givré. |

## Modifier le site plus tard

Sur GitHub, ouvre un fichier, clique sur le **crayon** (Edit), modifie, puis **Commit changes**. Le site est mis à jour une à deux minutes plus tard. Si tu ne vois pas le changement, recharge la page deux fois (ou ferme et rouvre l'application sur l'iPhone).

## Dépannage

| Ce que tu vois | Cause et solution |
|---|---|
| « Dernière étape : la configuration » | `js/config.js` n'est pas rempli (étape 3), ou les apostrophes ont sauté. |
| « Impossible de charger tes données » | Le SQL n'a pas été exécuté (étape 2), ou le projet Supabase est **en pause** : rouvre le tableau de bord Supabase et relance-le avec le bouton proposé (**Restore** / **Resume project**). |
| Le lien de l'email ouvre `localhost:3000` ou une page d'erreur | L'étape 5 n'est pas faite, ou l'adresse saisie n'est pas exactement celle du site (attention au `/` final). |
| Aucun email reçu / « adresse non acceptée » | Voir l'encadré de l'étape 6 : seules les adresses des membres du projet reçoivent des emails, 2 par heure au maximum. |
| « Ce lien n'est plus valable » | Un lien d'email ne sert qu'une fois et expire rapidement : redemande-en un. |
| Page 404 sur `github.io` | Attends quelques minutes après l'activation ; vérifie que `index.html` est bien à la racine du dépôt et que Pages est réglé sur **main** / **root**. |
| Les résumés restent en anglais | Le quota gratuit du traducteur est atteint pour la journée (voir [limites](#limites-à-connaître)). Ils seront traduits à une prochaine visite. |
| Un film n'a pas d'affiche ou pas de résumé | Wikipédia n'en a pas pour ce film, ou n'a pas répondu ce jour-là ; dans ce second cas, la fiche se complète toute seule à une prochaine visite. |
| La recherche « ne répond pas pour le moment » | Une des sources gratuites est momentanément indisponible ou limite les demandes. Attends une minute et réessaie. |

---

## Comment c'est fait

```
macinetheque/
├── index.html              page unique du site
├── manifest.webmanifest    description de l'application installable (PWA)
├── sw.js                   service worker : installation + ouverture hors-ligne
├── css/style.css           toute la mise en forme (couleurs via variables de thème, responsive)
├── icons/                  icônes (favicon, iPhone, Android)
├── lib/supabase.js         bibliothèque officielle Supabase (copie locale, v2.119.0)
├── supabase/
│   ├── schema.sql          ← installation neuve : tout le schéma (tables + règles RLS)
│   ├── migration_v2.sql    ← mise à jour V1 → V2
│   └── migration_v3.sql    ← mise à jour V2 → V3
└── js/
    ├── config.js           ← LE fichier à remplir (URL + clé Supabase)
    ├── theme.js            thèmes de couleurs, appliqués avant l'affichage (pas de flash)
    ├── app.js              démarrage, connexion, navigation entre les pages
    ├── supabase.js         connexion à Supabase
    ├── store.js            lecture / écriture des données de l'utilisateur
    ├── catalog.js          recherche unifiée films + séries, chargement des fiches
    ├── utils.js            petites fonctions utiles (dates, durées, création d'éléments…)
    ├── api/
    │   ├── tvmaze.js       séries, saisons, épisodes
    │   ├── itunes.js       films (boutique iTunes française)
    │   ├── wikidata.js     films + pays (Wikidata), séries par début de titre ; affiche et résumé (Wikipédia)
    │   └── translate.js    traduction anglais → français (MyMemory) + cache
    ├── ui/
    │   ├── search.js       barre de recherche et autocomplétion
    │   ├── stars.js        étoiles de notation
    │   ├── datepicker.js   sélecteur de date (Aujourd'hui, Hier, calendrier, Date inconnue)
    │   ├── confirm.js      confirmation d'enregistrement en grand (et écran d'échec)
    │   ├── password.js     champ mot de passe avec œil + vérification de la confirmation
    │   ├── quickrate.js    fenêtre « Déjà vu → noter » de la page Pour toi
    │   ├── logo.js         le logo (caméra à bobines)
    │   ├── cards.js        affiches, grilles, squelettes, états vides
    │   └── charts.js       graphiques SVG des statistiques
    ├── stats/
    │   ├── core.js         règles communes du temps de visionnage (stats, récaps, acteurs)
    │   └── complete.js     complète durées et acteurs des œuvres déjà notées
    ├── recap/
    │   ├── service.js      récaps disponibles, calcul et cache
    │   ├── story.js        lecture plein écran façon « stories »
    │   └── share.js        image 1080 × 1920 à partager
    ├── import/
    │   ├── parse.js        lecture des historiques Netflix / Prime Video, regroupement, épisodes
    │   └── match.js        retrouve chaque titre dans le catalogue
    ├── reco/
    │   ├── profile.js      profil de goûts, score et raison d'une suggestion, variété
    │   └── engine.js       recherche des œuvres candidates, cache de 24 h, classement
    └── views/
        ├── auth.js         connexion, inscription, mot de passe oublié
        ├── collection.js   ma collection (tri, filtres)
        ├── watchlist.js    liste à voir
        ├── foryou.js       page « Pour toi » (suggestions)
        ├── item.js         fiche d'une œuvre et notation
        ├── results.js      page de résultats de recherche
        ├── stats.js        statistiques (temps, compteurs, acteurs)
        ├── recaps.js       page « Récaps »
        ├── settings.js     page « Réglages » (couleurs, mode)
        ├── import.js       page « Importer » (Netflix, Prime Video)
        └── account.js      compte (déconnexion, mot de passe, export)
```

### Base de données

| Table | Contenu | Qui y a accès |
|---|---|---|
| `items` | Les œuvres enregistrées : source, identifiant, type, titre, année, pays, genres, affiche, résumés, durée ; depuis la V2 : identifiant Wikidata, réalisateurs, acteurs principaux | Uniquement son propriétaire |
| `ratings` | Notes (1 à 5), commentaires, dates — tous facultatifs ; `season` et `episode` vides = l'œuvre entière, `season` seule = une saison. Une seule ligne par (utilisateur, œuvre, saison, épisode). Dates futures refusées | Uniquement son propriétaire |
| `watchlist` | La liste à voir | Uniquement son propriétaire |
| `dismissed_suggestions` | Les suggestions écartées avec « Pas intéressé » (V2) | Uniquement son propriétaire |
| `suggestions_cache` | Les suggestions calculées, gardées environ 24 h (V2) | Uniquement son propriétaire |
| `translations_cache` | Empreinte du texte original → traduction française | Tout utilisateur connecté : lecture et ajout seulement (aucune donnée personnelle) |
| `recaps` | Récaps du mois et de l'année déjà calculés, avec leur empreinte (recalculés si une note de la période change) et la date d'ouverture (V3) | Uniquement son propriétaire |
| `user_settings` | Thème de couleurs et mode (V3) | Uniquement son propriétaire |
| `people` | Acteurs : identifiant Wikidata (`Q…`) ou TVMaze (`tm…`), nom, photo (V3) | Tout utilisateur connecté : lecture et ajout seulement (données publiques) |
| `item_cast` | Acteurs principaux de chaque film ou série (V3) | Tout utilisateur connecté : lecture et ajout seulement |

La table `items` garde aussi, depuis la V3, la durée de chaque épisode par saison (`seasons_meta`), pour le temps de visionnage.

La **Row Level Security** est activée sur les 10 tables ; un visiteur non connecté n'a accès à rien.

### Comment sont calculées les suggestions

1. **Profil de goûts**, recalculé à chaque note : 5★ = +2, 4★ = +1, 3★ = 0, 2★ = −1, 1★ = −2. Pour une série, c'est la note la plus précise qui compte (la série, sinon la moyenne des saisons, sinon celle des épisodes). Ces points vont aux genres, réalisateurs, acteurs principaux, pays et décennies de l'œuvre. La liste « à voir » compte pour +0,5, un « Pas intéressé » pour −0,5.
2. **Œuvres candidates**, sans clé API : pour les films, Wikidata (films des mêmes réalisateurs, des mêmes acteurs, des mêmes genres, en écartant ceux dont presque aucune Wikipédia ne parle) ; pour les séries, TVMaze (les autres séries bien notées des acteurs de tes séries préférées) et les séries les plus connues.
3. **Score** = somme des points correspondants + un bonus de popularité. La raison affichée est le point commun qui pèse le plus. Deux films du même réalisateur ne se suivent jamais plus de deux fois.
4. Ce que tu as déjà noté, mis « à voir » ou refusé n'est jamais proposé.
5. Avec moins de 3 œuvres notées, la page propose des œuvres populaires et t'invite à noter davantage.
6. Le résultat est gardé 24 h dans Supabase (ouverture instantanée) et recalculé dès que tes goûts principaux changent, ou avec **Rafraîchir**.

Le site complète tout seul, une fois, les œuvres déjà enregistrées avec leurs réalisateurs et acteurs (à la première ouverture de **Pour toi**).

### Sources de données et appels depuis le navigateur (CORS)

Toutes les API utilisées autorisent les appels depuis un site web : **aucun serveur intermédiaire (proxy) n'est nécessaire**.

| Source | Sert à | Clé | Appelable du navigateur |
|---|---|---|---|
| TVMaze `api.tvmaze.com` | Séries, saisons, épisodes ; acteurs et leurs autres séries (suggestions) | Aucune | ✅ vérifié |
| iTunes Search `itunes.apple.com` | Films : titre, affiche (600×600), résumé français | Aucune | ✅ vérifié |
| Wikidata `query.wikidata.org` | Films : recherche, année, pays de production, genres, durée. Séries : recherche par début de titre | Aucune | ✅ vérifié |
| Wikipédia `fr.` / `en.wikipedia.org` | Films : affiche et résumé d'introduction | Aucune | ✅ vérifié |
| MyMemory `api.mymemory.translated.net` | Traduction anglais → français | Aucune | ✅ vérifié |

## Limites à connaître

- **Films** : l'API iTunes ne renvoie aujourd'hui presque plus de films (« Inception » y est introuvable) et bloque au-delà d'une vingtaine de recherches par minute. Le site l'interroge toujours en premier, mais c'est **Wikidata + Wikipédia** qui fournit la plupart des films. Conséquences : les affiches venant de Wikipédia sont de petite taille, et le « résumé » est l'introduction de l'article Wikipédia plutôt qu'un vrai synopsis.
- **Recherche de films** : elle passe par Wikidata, qui met d'une à quelques secondes à répondre. Les séries (TVMaze) s'affichent tout de suite, les films arrivent un instant après.
- **Recherche de séries** : TVMaze ne cherche que des mots entiers. Les séries sont donc aussi cherchées sur Wikidata, qui trouve les débuts de titre (« break » → Breaking Bad) ; elles apparaissent alors une ou deux secondes après les premières suggestions.
- **Traduction** : MyMemory offre 5 000 caractères par jour sans inscription. Les résumés d'épisodes ne sont donc traduits que lorsqu'ils apparaissent à l'écran, et chaque traduction est conservée pour toujours dans Supabase. Pour passer à 50 000 caractères par jour, indique une adresse email dans `MYMEMORY_EMAIL` (`js/config.js`) — elle sera visible publiquement dans le code.
- **Suggestions** : le premier calcul prend 15 à 25 secondes (les films s'affichent d'abord, les séries ensuite) ; les ouvertures suivantes sont instantanées pendant 24 h. Les « acteurs principaux » d'un film sont ses acteurs les plus connus, faute d'ordre d'affiche dans Wikidata. Les acteurs de films et de séries ne sont pas reliés entre eux : aimer un acteur dans une série ne fait pas encore remonter ses films.
- **Affiches des suggestions de films** : elles viennent de Wikipédia, une par une. Si Wikipédia limite les demandes, certaines apparaissent avec quelques secondes de retard, ou à la visite suivante.
- **Supabase gratuit** : un projet sans aucune visite pendant une semaine est **mis en pause**. Tes données ne sont pas perdues : rouvre le tableau de bord Supabase et relance le projet avec le bouton proposé.
- **Acteurs des films** : Wikidata ne donne pas l'ordre de l'affiche ; les « acteurs principaux » d'un film sont donc ses 10 acteurs les plus connus. Pour les séries, ce sont les 10 premiers de la distribution TVMaze. Quelques photos manquent : un rond avec les initiales les remplace.
- **Durées** : quand ni Wikidata ni TVMaze ne connaissent la durée, le site compte 110 min par film et 45 min par épisode, et l'indique (« durée estimée »).
- **Netflix et Prime Video** : aucun des deux ne permet à un autre site de se connecter à ton compte (pas d'accès officiel), et il ne faut jamais donner ce mot de passe à un autre site. L'import part donc du fichier que Netflix te laisse télécharger et du texte de la page d'historique de Prime Video. Netflix donne les titres d'épisodes en français et TVMaze en anglais : quand le titre ne correspond pas, l'épisode est placé au plus petit numéro libre de la saison, dans l'ordre où tu les as vus. Netflix compte aussi ce qui a seulement été commencé. Le bouton-favori Prime Video a été testé sur une page qui imite la vraie : si Amazon change sa page, le copier-coller manuel reste possible.
- **Hors-ligne** : l'application s'ouvre sans réseau, mais noter ou chercher demande une connexion.

## Tests réalisés

Le site a été testé dans un vrai navigateur (Chromium piloté automatiquement) contre une installation locale des briques logicielles de Supabase (leur base PostgreSQL, leur serveur d'authentification, leur API de données) et contre les vraies API de films et séries.

| Domaine | Vérifications |
|---|---|
| **Sécurité (RLS)** — 65 contrôles | Deux comptes A et B : B ne voit aucune ligne de A, ne peut ni modifier ni supprimer ses notes (même en visant leurs identifiants), ni écrire en son nom, ni rattacher une note à une œuvre de A ; un visiteur non connecté n'a accès à rien ; notes hors de 1 à 5 refusées ; pas de doublon par (utilisateur, œuvre, saison, épisode). |
| **Couverture du catalogue** — 1 478 œuvres | Les 569 films les plus connus au monde, 266 films français, 500 séries très connues et 143 séries françaises, passés un par un dans la recherche du site : **1 478 trouvés sur 1 478**, dont 1 477 dans les 8 premières suggestions (le dernier, raté passager de Wikidata, est trouvé en tête au nouvel essai) ; titre original ou anglais : 784 sur 785. |
| **Recherche** | « Inception » (film) et « Breaking Bad » (série) trouvés, y compris dès « break » ; titres d'un mot courant (« Heat », « Seven », « Ça », « Alien », « Up » → *Là-haut*) ; films et séries mélangés ; attente de 300 ms ; texte grisé accepté par Tab et → ; flèches, Entrée, Échap ; message propre sans résultat. |
| **Fiches et notation** | Film : affiche, année, pays, genres, durée, note, commentaire, date, modification, suppression. Série : 5 saisons / 62 épisodes, note globale, note de saison, note d'épisode, « marquer toute la saison comme vue » sans écraser les notes. Tout est conservé après rechargement. |
| **Traduction** | Résumés de série et d'épisode traduits ; lien « voir l'original » ; aucune retraduction après rechargement (cache Supabase) ; quota dépassé et panne gérés. |
| **Collection, liste à voir, statistiques** | Les 4 tris, tous les filtres, recherche sans accents ; passage « à voir » → « vu » ; chiffres des statistiques comparés à un calcul indépendant. |
| **Comptes** | Inscription avec email de confirmation, connexion, déconnexion, session conservée, mot de passe oublié de bout en bout, lien expiré, pages inaccessibles sans connexion. |
| **Robustesse** | Chaque source coupée tour à tour : messages clairs, aucune erreur, la collection reste consultable. |
| **Mobile et PWA** | Format iPhone : aucun débordement, barre de navigation en bas ; manifest, icônes, service worker, ouverture hors-ligne. |
| **V2 — notation des séries** | Breaking Bad : saison 1 notée seule (aucun épisode créé) ; 3 épisodes de la saison 2 notés sans la saison ; série notée seule ; moyennes indicatives (« moy. épisodes 4,0 ») jamais enregistrées ; modifier, retirer ou supprimer un niveau ne touche pas aux autres ; « marquer toute la saison comme vue » avec date inconnue : 13 épisodes vus, aucune note. |
| **V2 — sélecteur de date** | Pré-rempli à la date du jour (heure de Paris) ; « Hier », « Choisir une date… », « Date inconnue » ; date future refusée par le site **et** par la base. |
| **V2 — confirmation en grand** | Coche, titre, « Saison 1 » / « S02E01 », étoiles ; disparition seule (~1,2 s) ou d'un clic ; écran d'échec avec « Réessayer » sans perte du commentaire ; version simple si « moins d'animations » est activé. |
| **V2 — suggestions** | Compte neuf : œuvres populaires + invitation à noter. Après 5 notes : films de Nolan en tête (« Parce que tu as aimé *Inception* (même réalisateur) »), jamais plus de deux à la suite, séries via les acteurs de Breaking Bad, rien de déjà noté, Cameron écarté après un 2★ ; cache relu sans aucune requête ; filtres ; « Déjà vu → noter » (film, et épisode précis d'une série), « À voir », « Pas intéressé » ; rien ne revient après rechargement. |
| **V2 — mots de passe et logo** | Œil (focus et curseur conservés), confirmation en direct, bouton bloqué tant que les deux diffèrent ; logo caméra partout, icônes 32 / 180 / 192 / 512, service worker en version 2. |
| **V3 — temps de visionnage** — 40 contrôles | Compte de test (7 œuvres, 14 notes datées) : somme des jours = total du mois, somme des mois = total de l'année, années + « date inconnue » = « depuis toujours » ; saison 1 marquée vue sans épisodes → 7 épisodes comptés, l'épisode noté à part une seule fois à sa propre date ; durée manquante complétée ; flèches bloquées avant le premier visionnage et après aujourd'hui ; graphiques (12 mois, 31 jours) ; liste d'un jour. |
| **V3 — acteurs** | Filtres Films / Séries / Les deux comparés au calcul commun ; aucun acteur de série dans « Films » ; préféré seulement avec au moins 2 œuvres notées (septembre : aucun) ; formats « 10 h · 1 œuvre » et « 4,6★ de moyenne sur 4 œuvres » ; fiche acteur ; initiales sans photo. |
| **V3 — récaps** — 31 contrôles | Bannière « Ton récap d'octobre est prêt » qui ouvre le récap ; pas de récap pour le mois en cours ni les mois vides ; écrans sans données sautés ; toucher, glisser, clavier, barres de progression ; chiffres animés (et directs si « moins d'animations ») ; image PNG 1080 × 1920 ; marqué vu dans Supabase ; cache relu, puis recalculé après une note modifiée ; année « en cours » au 2 décembre et définitive au 1er janvier (date simulée). |
| **V3 — thèmes** — 23 contrôles | Palette « Bleu givré » exacte au premier lancement ; 10 thèmes × sombre / clair appliqués en direct avec contrastes WCAG AA ; Duo ; couleur personnalisée (roue et code) avec nuances calculées ; mode automatique ; pas de flash (thème posé avant la feuille de style) ; même thème sur un 2e appareil après connexion ; Réinitialiser ; aucune trace d'ambre hors du thème « Ambre ». |
| **Semaine** — 11 + 7 contrôles | Semaine du lundi au dimanche (y compris à cheval sur deux mois ou deux années) ; somme des 7 jours = total de la semaine ; somme des semaines = total du mois ; moyenne par jour (sur les jours écoulés pour la semaine en cours) ; 7 barres « lun 9… dim 15 » ; flèches et calendrier (un jeudi choisi → sa semaine) ; tient sur iPhone SE. |
| **Import Netflix / Prime Video** — 36 + 28 + 7 contrôles | 16 formes de titres Netflix (français, anglais, « Partie », « Mini-série », « Stranger Things 2 », films avec « : ») ; dates françaises et américaines ; export Amazon ; texte Prime Video avec menus et boutons ignorés. Compte de test : Breaking Bad, La casa de papel, Stranger Things, Le Jeu de la dame, Intouchables, Parasite retrouvés ; titre inexistant non coché ; épisode revu compté une fois à sa 1re date ; note 5★ conservée et date manquante complétée ; film retiré de « à voir » ; 2e import identique sans doublon. Bouton-favori sur une fausse page Prime : défilement complet, épisodes dépliés, aucun bouton « Supprimer » touché. |
| **Accessibilité** — 52 pages contrôlées | Outil axe-core (règles WCAG 2.1 AA) sur les 13 écrans, sur ordinateur et iPhone, en mode sombre et clair : aucun défaut restant (contrastes, titres, libellés, graphiques, liens). Couleurs vérifiées sur 36 palettes (10 thèmes + couleurs extrêmes, sombre et clair) : texte des boutons lisible même au survol et à l'appui. Détecteur automatique de « null » / « undefined » affichés pendant tous les tests. |
| **Pannes des sources** — 6 contrôles | Wikidata, Wikipédia ou TVMaze coupés : fiche « indisponible » avec **Réessayer**, film déjà enregistré affiché depuis sa copie, recherche qui l'indique, statistiques toujours là ; base injoignable pendant une note : écran d'échec avec **Réessayer**. |
| **Recherche** — 7 contrôles | « inception » ne propose plus de séries sans rapport (« Deception ») ; les fautes de frappe (« breking bad », « stranger tings ») et les titres étrangers (« la casa de papel », « up » → *Là-haut*) restent trouvés. |
| **V3 — iPhone** — 22 contrôles | iPhone SE et iPhone 13 : barre du bas à 6 onglets lisibles, aucune page qui déborde, sélecteur de période sur une ligne, récaps en plein écran sans texte coupé. |
| **V3 — sécurité et migration** | 15 contrôles de plus : `recaps` et `user_settings` invisibles et intouchables pour un autre compte ; `people` / `item_cast` en lecture + ajout seulement, personne ne peut modifier ni effacer ; migration appliquée deux fois sans changer aucune donnée ; `schema.sql` complet vérifié sur une base neuve. |
| **V2 — migration** | Script appliqué deux fois sur une base remplie : toutes les données identiques avant / après ; le site fonctionne aussi tant que le script n'est pas collé. |

Non testé ici, faute de pouvoir créer des comptes à ta place : le projet Supabase **en ligne**, la publication **GitHub Pages** et l'installation sur un **vrai iPhone**.
