# Titrix — gestion des titres financiers

Application web qui remplace le classeur Excel de gestion des titres : référentiel des instruments,
positions par conservateur, opérations avec validation à quatre yeux, échéanciers automatiques,
coupons courus, encaissements, grevage, arrêtés verrouillés, alertes, exports et journal d'audit.

> Aucune donnée réelle (titres, positions, contreparties) ne doit être versée dans ce dépôt.
> Les essais se font avec des données fictives.

## Démarrer en 5 minutes (mise en ligne)

1. **Vercel** → *Add New Project* → importer ce dépôt GitHub → *Deploy* (aucun réglage de build à changer).
2. **Base Neon** : dans le projet Vercel → *Storage* → *Create Database* → **Neon** (région *Frankfurt*),
   relier au projet : la variable `DATABASE_URL` est créée automatiquement.
3. **Console Neon** → *SQL Editor* : coller puis exécuter, dans l'ordre,
   [`base/01_tables.sql`](base/01_tables.sql), [`base/02_regles.sql`](base/02_regles.sql),
   [`base/03_donnees_initiales.sql`](base/03_donnees_initiales.sql).
4. Vercel → *Deployments* → *Redeploy*, puis ouvrir l'adresse du site : l'écran **Installation**
   propose de créer le premier administrateur (il disparaît ensuite).

Le détail pas à pas, avec captures des réglages, est dans [`GUIDE_PROJET.md`](GUIDE_PROJET.md).

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Lancer en local (avec `DATABASE_URL` dans `.env.local`) |
| `npm test` | Tests du moteur de calcul (critères de recette du cahier des charges) |
| `npm run lint` · `npm run typecheck` | Analyse du code et contrôle des types |
| `npm run build` | Construction de production |
| `psql … -f base/tests/regles.sql` | Tests des règles de gestion de la base (sur une base de test) |
| `npm run test:parcours` | Parcours complet dans un navigateur (Playwright, base de test vide) |

## Pile technique

Next.js 16 (App Router, actions serveur) · React 19 · TypeScript strict · Tailwind CSS 4 ·
PostgreSQL (Neon) via `pg` · ExcelJS · Vitest · Playwright. Hébergement Vercel.

## Le point de sécurité le plus important

Les contrôles bloquants du cahier des charges sont appliqués **par la base elle-même**
(`base/02_regles.sql`), pas seulement par les écrans : validation par une autre personne que l'initiateur,
nominal jamais négatif, grevage ≤ disponible, arrêté verrouillé, données obligatoires, journal et audit en
ajout seul. L'application indique à la base qui agit (`app.utilisateur_id`) au début de chaque transaction.

## Où se trouve quoi

- `src/moteur/` — calcul financier pur (dates, échéanciers, positions, encaissements, indicateurs, contrôles).
- `src/donnees/` — seul point d'accès à la base (lectures, chargement du portefeuille, imports, états).
- `src/app/actions/` — actions serveur (une par domaine), `src/app/(espace)/` — un dossier par écran.
- `base/` — scripts SQL à exécuter dans Neon, et leurs tests.

Avant de toucher au code : lire [`CODEBASE.md`](CODEBASE.md). Une règle de calcul se change en trois temps :
décision écrite → test mis à jour → moteur modifié ; rien n'est livré si `npm test` n'est pas au vert.
