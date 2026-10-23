# Scripts SQL de Titrix — guide

À exécuter dans la console Neon (*SQL Editor* → coller le contenu du fichier → *Run*), **dans cet ordre** :

| Ordre | Fichier | Contenu |
| --- | --- | --- |
| 1 | `01_tables.sql` | Les 30 tables (référentiels, instruments, positions, opérations, échéances, encaissements, grevages, arrêtés, imports, quarantaine, journal, audit…) |
| 2 | `02_regles.sql` | Les règles de gestion : contrôles bloquants, circuit de validation, arrêtés verrouillés, audit automatique, journal en ajout seul |
| 3 | `03_donnees_initiales.sql` | Paramètres par défaut, devises, pays UEMOA / CEMAC, types d'instruments, tranches de maturité, un portefeuille |

Les trois scripts sont **rejouables** : les exécuter une seconde fois ne crée rien en double et n'efface
aucune donnée. Après une mise à jour de Titrix qui modifie un script, il suffit de le rejouer (même ordre).

## Mises à jour d'une base existante

Pour une base déjà en service, le dossier `mises_a_jour/` contient des **correctifs courts**, datés, à
exécuter une seule fois dans l'ordre des dates (nouvelle requête ⊕ dans le *SQL Editor* de Neon, pas depuis
l'historique qui tronque les longs scripts). Ils sont rejouables et ne suppriment aucune donnée.

| Fichier | Contenu |
| --- | --- |
| `mises_a_jour/2026-10-23_encaissements_capital_interets.sql` | Ventilation de chaque encaissement entre capital et intérêts (colonnes `montant_capital`, `montant_interet`, contrôle capital + intérêts = montant) ; reprise des encaissements existants, intérêts réputés payés en premier |

Le premier administrateur n'est **pas** créé par SQL (aucun mot de passe dans ces fichiers) : ouvrez
l'application, l'écran « Installation » apparaît tant qu'aucun compte n'existe.

## Tests des règles

`tests/regles.sql` joue 27 scénarios (validation par l'initiateur refusée, grevage excessif, nominal
négatif, arrêté verrouillé, journal non modifiable…) dans une transaction **annulée à la fin**.
À lancer uniquement sur une base de test (par exemple une branche Neon) :

```
psql "<adresse de la base de test>" -v ON_ERROR_STOP=1 -f base/tests/regles.sql
```

Résultat attendu : « TOUS LES TESTS DES RÈGLES SONT PASSÉS ».

## Comptes de la base

L'application se connecte avec la variable `DATABASE_URL` fournie par Neon. Ne la copiez jamais dans un
fichier du dépôt. Pour les sauvegardes : Neon conserve un historique permettant une restauration à un instant donné
(la durée dépend de votre offre) ; pour un test de restauration, créez une *branche* Neon à une date passée.

## Outils

| Fichier | Usage |
| --- | --- |
| `outils/vider_portefeuille.sql` | Efface tout le portefeuille (démonstration, essais d'import) avant le démarrage réel. Conserve les comptes, les paramètres et les référentiels ; retire les référentiels « Démo » et désactive les comptes fictifs. **Irréversible.** |
