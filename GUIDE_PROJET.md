# Titrix — guide du projet

État au 15 octobre 2026 : **socle initial du cahier des charges livré** (§3.1), testé de bout en bout sur une
base de test avec des données fictives. Ce guide explique la mise en ligne, les écrans, la base et les tests.

## 1. Mise en ligne (à faire une fois)

### a. Vercel
1. Sur vercel.com → **Add New… → Project** → choisir le dépôt GitHub `Titrix` → **Deploy**.
   Les réglages proposés (Next.js, `npm run build`) sont les bons. Le premier déploiement affichera une erreur
   de base tant que l'étape b n'est pas faite : c'est normal.

### b. Base Neon reliée à Vercel
1. Dans le projet Vercel → onglet **Storage** → **Create Database** → **Neon** → région **Frankfurt (eu-central-1)**
   (Vercel est réglé sur Francfort dans `vercel.json`, pour des échanges rapides).
2. Relier la base au projet pour les environnements *Production* et *Preview* : Vercel crée seul la variable
   `DATABASE_URL`. **Vous n'avez aucun mot de passe à recopier.**

### c. Création des tables et des règles
Dans la console Neon (bouton *Open in Neon* depuis Vercel) → **SQL Editor** → coller puis **Run**, dans l'ordre :
1. `base/01_tables.sql` — doit afficher la liste des 30 tables ;
2. `base/02_regles.sql` — doit afficher « Règles Titrix installées. » ;
3. `base/03_donnees_initiales.sql` — doit afficher « Référentiels Titrix initialisés… ».

### d. Premier administrateur
Vercel → **Deployments** → **⋯ → Redeploy**. Ouvrez l'adresse du site : l'écran **Installation** demande nom,
e-mail et mot de passe du premier administrateur. Il disparaît dès qu'un compte existe.

### e. Premiers réglages dans l'application
1. **Paramètres** : nom de l'établissement, devise de référence, seuils d'alerte (J-30, J-15, J-7, J), tolérance.
2. **Référentiels** : conservateurs, émetteurs, contreparties / bénéficiaires, portefeuilles, jours fériés.
3. **Utilisateurs** : un compte par personne ; le mot de passe provisoire est affiché **une seule fois**, à
   transmettre de vive voix. Une même personne peut cumuler plusieurs profils, mais **ne peut jamais valider ce
   qu'elle a saisi** : il faut donc au moins deux personnes (une qui saisit, une qui valide).

## 2. Écrans

| Rubrique | Écran | Adresse | Rôle |
| --- | --- | --- | --- |
| Pilotage | Tableau de bord | `/` | 8 indicateurs du §8.1, tombées 12 mois, à surveiller, répartitions, échéances à 30 jours — à une date d'arrêté choisie |
| | Analyses | `/analyses` | Ventilation par pays, zone, émetteur, conservateur, instrument, type, portefeuille, classification, notation, grevage, maturité ; fiches des indicateurs |
| Portefeuille | Instruments | `/instruments` | Référentiel (ISIN contrôlé, code interne), validation à quatre yeux, échéancier contractuel, échéancier officiel, classifications historisées |
| | Positions | `/positions` | Un instrument × portefeuille × conservateur × compte ; situation à la date, opérations, échéancier, grevages, relevé du conservateur |
| | Opérations | `/operations` | Brouillon → Soumis → Validé / Rejeté → Réglé ; annulation motivée et opération corrective ; validation groupée ; pièces justificatives |
| | Grevages | `/grevages` | Affectations par bénéficiaire ; disponible contrôlé ; augmentation, réduction, mainlevée ; décote, valeur retenue, financement |
| Flux | Échéancier | `/echeancier` | Projection depuis l'encours résiduel, synthèses mensuelle / annuelle, flux au-delà de l'horizon, bouclage |
| | Encaissements | `/encaissements` | Prévue, à encaisser, partielle, encaissée, en retard, litige ; saisie et rapprochement ; amortissement proposé à la validation |
| Contrôle | Alertes et anomalies | `/controles` | Contrôles automatiques avec responsable et statut de traitement ; quarantaine des imports |
| | Arrêtés | `/arretes` | Photographie de la situation, verrouillage, réouverture motivée, détection des opérations rétrodatées |
| | États et exports | `/etats` | Les 9 états du §8.3 en Excel (couverture, sommaire, totaux par formule) ou CSV ; PDF par « Imprimer » |
| Administration | Import et reprise | `/import` | Dépôt .xlsx / .csv, correspondance des colonnes, aperçu, doublons, divergences, quarantaine ; modèles vierges |
| | Référentiels · Utilisateurs · Journal · Paramètres | `/referentiels` `/utilisateurs` `/journal` `/parametres` | Administration ; journal filtrable |

## 3. Règles de calcul retenues (à faire valider par la trésorerie)

Ces choix répondent aux « points à sécuriser » du §1.2 ; ils sont codés dans `src/moteur/` et testés :

- **Convention de décompte par instrument** (ACT/365, ACT/360, 30/360 européen, ACT/ACT ICMA). Le paramètre
  général ne sert que de valeur proposée à la création : la convention de l'instrument prévaut toujours.
- **Intérêt d'une période** = capital restant dû au début de la période × taux × α(convention).
- **Dates** : on remonte de l'échéance par pas de 12/fréquence mois ; la première période peut être irrégulière
  (fusionnée avec la suivante si elle fait moins de 7 jours) ; règle « fin de mois » ; date de règlement reportée
  au jour ouvré suivant (week-ends et jours fériés du référentiel).
- **Amortissement constant** : parts égales sur les périodes postérieures au différé (en mois depuis l'émission) ;
  intérêts dus pendant le différé ; dernière échéance ajustée (aucun reliquat). **Échéancier officiel validé
  prioritaire** sur l'échéancier généré.
- **Projection depuis l'encours détenu** : la forme contractuelle est appliquée au capital restant ; contrôle
  Σ capital futur + capital échu non remboursé = encours nominal.
- **Titre échu** : jamais considéré comme remboursé tant qu'une opération de remboursement n'est pas validée ;
  la créance reste visible et une alerte est levée.
- **Précomptés (bons du Trésor)** : aucun coupon futur, coupon couru nul (pas de double comptage).
- **Disponible** = nominal résiduel détenu − nominal grevé actif ; le financement obtenu n'est jamais soustrait.
- **Encaissement** : statut déduit des montants reçus et des dates ; « en retard » après le délai de tolérance.
- **Coupon moyen pondéré** affiché avec son hypothèse (détention au pair) ; rendement actuariel, duration et
  sensibilité réservés à l'extension « prix de marché ».

Questions du §14 restant à trancher avec l'établissement : sens exact de « Montant utilisé » du classeur
(repris ici comme **nominal grevé**), sources faisant foi, profondeur d'historique, règles comptables.

## 4. Base de données

30 tables, toutes créées par `base/01_tables.sql`. Les règles (`base/02_regles.sql`) bloquent en base :
nominal négatif, grevage > disponible, opération incomplète, validation ou annulation par l'initiateur,
modification d'une opération soumise, opération ou encaissement daté d'une période verrouillée, modification
d'un arrêté verrouillé sans réouverture motivée, désactivation du dernier administrateur, modification du journal
ou de l'audit. L'audit (table `audit`) garde auteur, date, ancienne et nouvelle valeur de chaque ligne modifiée.

## 5. Tests réalisés (15/10/2026, base PostgreSQL 16 de test, données fictives)

- **27 tests du moteur et de la reprise** (`npm test`) : tous les critères du §12 (in fine, différé, deux
  conservateurs, encours nul, titre échu, encaissement partiel, arrêté historique, précompté, Σ capital futur…).
- **27 scénarios de règles SQL** (`base/tests/regles.sql`) : tous passés.
- **Parcours navigateur complet** (`tests/parcours/parcours.mjs`) : **61 vérifications passées** — installation,
  comptes, instrument, position, validation à quatre yeux, grevage excessif refusé, encaissement partiel, arrêté
  verrouillé qui bloque une opération rétrodatée, les 9 exports Excel + CSV, import d'un classeur fictif
  (suffixes, #DIV/0!, divergence, disponible négatif, import répété sans doublon), téléphone et mode sombre sans
  débordement.
- Lint, contrôle des types et construction de production : sans erreur.

## 6. Prochaines étapes proposées (extensions §3.2 et exigences §10.2 non couvertes)

1. **Double authentification** (code à usage unique) pour les profils sensibles (validateur, administrateur).
2. **Planificateur** (tâche quotidienne Vercel Cron) : recalcul nocturne et envoi des alertes J-30/J-15/J-7 par
   e-mail aux responsables (nécessite un service d'envoi d'e-mails).
3. Valorisation aux prix de marché, rendement actuariel, duration et sensibilité.
4. Multidevise avec taux de conversion identifiés ; coupons variables ; écritures comptables ; interfaces
   automatiques avec les conservateurs ; simulations.
5. Environnements distincts : utiliser les *branches* Neon pour la recette (une branche = une copie de la base).
