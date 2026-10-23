# Plan du code de Titrix

Chiffres mesurés le 15/10/2026 : ≈ 5 000 lignes TypeScript (moteur, données, actions, bibliothèques) et
≈ 4 200 lignes d'écrans (TSX) ; 3 scripts SQL (≈ 1 100 lignes) ; 27 tests unitaires, 27 scénarios SQL, 61
vérifications de parcours.

## Architecture en une page

```
Navigateur ──► proxy.ts (cookie de session présent ?) ──► écrans  src/app/(espace)/**/page.tsx  (composants serveur)
                                                     └──► actions src/app/actions/*.ts  ("use server")
écrans / actions ──► src/donnees/*  (SEUL accès à la base)  ──► src/lib/db.ts  (pg, transaction(utilisateur, …))
                 └──► src/moteur/*  (calcul pur, sans base ni interface)
PostgreSQL (Neon) : tables + règles de gestion (base/02_regles.sql) + audit automatique
```

Les dépendances ne remontent jamais : `moteur` n'importe rien d'autre ; `donnees` utilise `moteur` et `lib` ;
les écrans et actions utilisent `donnees`, `moteur`, `lib` et `composants`. Un écran n'importe jamais un autre écran.

| Dossier / fichier | Rôle |
| --- | --- |
| `src/moteur/01_dates.ts` | Dates ISO, conventions de décompte, jours ouvrés |
| `src/moteur/02_echeancier.ts` | Échéancier contractuel en parts du nominal (généré ou officiel) |
| `src/moteur/03_position.ts` | Effets des opérations, échéances d'une position, coupon couru, situation à date |
| `src/moteur/04_encaissements.ts` | Statut des échéances, reste dû, intérêts nets, ventilation capital / intérêts |
| `src/moteur/05_indicateurs.ts` | Tranches de maturité, moyennes protégées, fiches des indicateurs |
| `src/moteur/06_portefeuille.ts` | Situation complète à une date (point de calcul unique de tous les écrans) |
| `src/moteur/07_controles.ts` | Contrôles et alertes, avec clé stable pour le suivi |
| `src/donnees/portefeuille.ts` | Chargement des données (filtrées par portefeuilles autorisés) et `analyser()` |
| `src/donnees/echeances.ts` | Échéances enregistrées, recalculées après chaque événement |
| `src/donnees/imports.ts` · `src/lib/import-regles.ts` | Reprise : aperçu, doublons, divergences, quarantaine |
| `src/donnees/etats.ts` · `src/lib/excel.ts` | Les 9 états et la charte des classeurs Excel |
| `src/lib/session.ts` · `src/lib/droits.ts` | Sessions (jeton aléatoire, empreinte en base) et matrice des droits |
| `src/composants/` | Coquille, composants d'affichage (`ui.tsx`), formulaires clients |

## Conventions

- Tout en français (noms, messages, commentaires). Montants : `numeric` en base, arrondi au centime au règlement,
  arrondi d'affichage seulement dans `lib/format.ts`. Dates : chaînes `AAAA-MM-JJ`.
- **Toute écriture** passe par `transaction(utilisateurId, …)` : la base sait qui agit et journalise.
- Les actions serveur suivent le modèle `try { exigerPermission → transaction → journaliser → revalidatePath → ok() }
  catch (e) { return erreur(e) }` ; les messages des règles SQL (code P0001) sont montrés tels quels.
- Le formulaire client (`composants/client/Formulaire.tsx`) n'efface la saisie qu'en cas de succès.
- Concurrence : verrou de ligne sur la position lors de chaque recalcul ; numéro de version vérifié à la
  modification d'un instrument ou d'un brouillon.

## Dette technique assumée

| Sujet | État | Piste |
| --- | --- | --- |
| Montants en `number` JavaScript dans le moteur | Suffisant jusqu'à 15 chiffres significatifs ; arrondi au centime à chaque échéance | Passer à un type décimal si des montants > 10¹³ apparaissent |
| Chargement complet du portefeuille à chaque écran de restitution | Adapté à quelques milliers de positions | Mettre en cache la situation par date, ou calculer en SQL |
| Alerte `npm audit` sur `uuid` (dépendance d'ExcelJS) | Non exploitable : ExcelJS n'utilise que `uuid.v4` sans tampon | Suivre une version d'ExcelJS corrigée |
| Double authentification, envoi d'alertes par e-mail | Non livrés | Voir GUIDE_PROJET.md §6 |

## Ce qui vous surveille

`npm run lint`, `npm run typecheck`, `npm test` (moteur et reprise), `base/tests/regles.sql` (règles en base),
`tests/parcours/parcours.mjs` (navigateur) ; la vérification GitHub (`.github/workflows/verification.yml`)
enchaîne lint → types → tests → scripts SQL rejoués deux fois → tests des règles → construction.
