-- =============================================================================
-- TITRIX — Script 1 sur 3 : création des tables
-- =============================================================================
-- Où l'exécuter : console Neon → votre projet → « SQL Editor » → coller tout le fichier → « Run ».
-- Le script est REJOUABLE : il ne crée que ce qui manque et n'efface aucune donnée.
-- Ordre : 01_tables.sql, puis 02_regles.sql, puis 03_donnees_initiales.sql.
--
-- Principes :
--  * l'INSTRUMENT (caractéristiques communes du titre) est séparé de la POSITION
--    (détention dans un portefeuille, chez un conservateur) ;
--  * les montants sont en numeric (décimal exact) : précision de calcul 6 décimales,
--    montants de règlement arrondis à 2 décimales ;
--  * rien n'est jamais effacé silencieusement : annulations et corrections sont tracées,
--    le journal et l'audit sont en ajout seul (voir 02_regles.sql).
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Utilisateurs, sessions, droits
-- -----------------------------------------------------------------------------
create table if not exists utilisateurs (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  nom                text not null,
  -- Un compte peut cumuler plusieurs profils (ex. gestionnaire + validateur) ;
  -- il ne pourra jamais valider ce qu'il a lui-même initié.
  roles              text[] not null default '{}',
  mot_de_passe_hash  text not null,
  actif              boolean not null default true,
  doit_changer_mdp   boolean not null default true,
  tentatives_echouees int not null default 0,
  bloque_jusqua      timestamptz,
  derniere_connexion timestamptz,
  cree_le            timestamptz not null default now(),
  constraint utilisateurs_roles_valides check (
    roles <@ array['gestionnaire','back_office','validateur','comptabilite','risques','direction','admin','auditeur']::text[]
  )
);
create unique index if not exists utilisateurs_email_unique on utilisateurs (lower(email));

create table if not exists sessions (
  id             uuid primary key default gen_random_uuid(),
  jeton_hash     text not null unique,         -- empreinte SHA-256 du jeton (le jeton lui-même n'est jamais stocké)
  utilisateur_id uuid not null references utilisateurs(id) on delete cascade,
  cree_le        timestamptz not null default now(),
  vu_le          timestamptz not null default now(),
  expire_le      timestamptz not null,
  adresse_ip     text,
  navigateur     text
);
create index if not exists sessions_utilisateur on sessions (utilisateur_id);

-- -----------------------------------------------------------------------------
-- 2. Référentiels
-- -----------------------------------------------------------------------------
create table if not exists pays (
  code text primary key check (code ~ '^[A-Z]{2}$'),
  nom  text not null,
  zone text not null default ''
);

create table if not exists devises (
  code      text primary key check (code ~ '^[A-Z]{3}$'),
  libelle   text not null,
  decimales int not null default 2 check (decimales between 0 and 4)
);

create table if not exists types_instrument (
  code      text primary key,
  libelle   text not null,
  -- Titre à intérêts précomptés (bon du Trésor) : rémunération incluse dans le prix.
  precompte boolean not null default false
);

create table if not exists emetteurs (
  id        uuid primary key default gen_random_uuid(),
  nom       text not null unique,
  pays_code text references pays(code),
  secteur   text not null default '',
  actif     boolean not null default true
);

create table if not exists conservateurs (
  id    uuid primary key default gen_random_uuid(),
  nom   text not null unique,
  code  text not null default '',
  actif boolean not null default true
);

-- Contreparties de marché et bénéficiaires de grevage (banque centrale, prêteurs…).
create table if not exists contreparties (
  id    uuid primary key default gen_random_uuid(),
  nom   text not null unique,
  role  text not null default 'les_deux' check (role in ('contrepartie','beneficiaire','les_deux')),
  actif boolean not null default true
);

create table if not exists entites (
  id  uuid primary key default gen_random_uuid(),
  nom text not null unique
);

create table if not exists portefeuilles (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  libelle   text not null,
  entite_id uuid references entites(id),
  actif     boolean not null default true
);

-- Restriction des droits par portefeuille : un compte sans ligne ici voit tous les portefeuilles.
create table if not exists utilisateurs_portefeuilles (
  utilisateur_id  uuid not null references utilisateurs(id) on delete cascade,
  portefeuille_id uuid not null references portefeuilles(id) on delete cascade,
  primary key (utilisateur_id, portefeuille_id)
);

-- Tranches de maturité (bornes en jours restants, borne basse incluse, borne haute exclue).
create table if not exists tranches_maturite (
  id         uuid primary key default gen_random_uuid(),
  libelle    text not null unique,
  borne_min  int not null check (borne_min >= 1),
  borne_max  int check (borne_max is null or borne_max > borne_min),
  ordre      int not null default 0
);

create table if not exists jours_feries (
  date    date primary key,
  libelle text not null default ''
);

-- Paramètres généraux (seuils d'alerte, tolérances, devise de référence…).
create table if not exists parametres (
  cle         text primary key,
  valeur      text not null,
  description text not null default '',
  modifie_le  timestamptz not null default now(),
  modifie_par uuid references utilisateurs(id)
);

-- -----------------------------------------------------------------------------
-- 3. Instruments (référentiel titres)
-- -----------------------------------------------------------------------------
create table if not exists instruments (
  id                     uuid primary key default gen_random_uuid(),
  code_interne           text not null unique,                 -- identifiant interne, sans suffixe de position
  isin                   text unique check (isin is null or isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  libelle                text not null,
  emetteur_id            uuid references emetteurs(id),
  pays_code              text references pays(code),
  zone                   text not null default '',
  type_code              text references types_instrument(code),
  devise_code            text not null references devises(code),
  nominal_unitaire       numeric(24,6) check (nominal_unitaire is null or nominal_unitaire > 0),
  date_emission          date,
  date_echeance          date,
  taux_coupon            numeric(12,8) not null default 0 check (taux_coupon >= 0 and taux_coupon < 1), -- fraction : 0,065 = 6,5 %
  convention             text not null default 'ACT/365' check (convention in ('ACT/365','ACT/360','30/360','ACT/ACT')),
  frequence              int not null default 1 check (frequence in (0,1,2,4,12)),     -- paiements par an (0 = à l'échéance)
  profil                 text not null default 'in_fine' check (profil in ('in_fine','constant')),
  differe_mois           int not null default 0 check (differe_mois >= 0),
  precompte              boolean not null default false,
  taux_retenue           numeric(8,6) not null default 0 check (taux_retenue >= 0 and taux_retenue < 1),
  conditions_remboursement text not null default '',
  -- Circuit de validation des caractéristiques : a_valider → valide (ou rejete).
  statut                 text not null default 'a_valider' check (statut in ('a_valider','valide','rejete')),
  motif_rejet            text,
  echeancier_officiel_valide boolean not null default false,
  cree_par               uuid references utilisateurs(id),
  cree_le                timestamptz not null default now(),
  modifie_par            uuid references utilisateurs(id),
  modifie_le             timestamptz not null default now(),
  valide_par             uuid references utilisateurs(id),
  valide_le              timestamptz,
  version                int not null default 1,
  constraint instruments_dates check (date_emission is null or date_echeance is null or date_emission < date_echeance)
);

-- Échéancier contractuel officiel importé : il fait foi lorsqu'il est validé.
create table if not exists echeancier_officiel (
  id            uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references instruments(id) on delete cascade,
  date_echeance date not null,
  part_capital  numeric(18,12) not null check (part_capital >= 0 and part_capital <= 1), -- part du nominal d'origine
  source        text not null default '',
  importe_par   uuid references utilisateurs(id),
  importe_le    timestamptz not null default now(),
  unique (instrument_id, date_echeance)
);

-- Classifications comptables et notations, historisées (valeur applicable = dernière date d'effet ≤ date).
create table if not exists classifications (
  id            uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references instruments(id) on delete cascade,
  position_id   uuid,  -- facultatif : classification propre à une position (contrainte ajoutée plus bas)
  referentiel   text not null check (referentiel in ('comptable','notation','autre')),
  valeur        text not null,
  date_effet    date not null,
  source        text not null default '',
  saisi_par     uuid references utilisateurs(id),
  saisi_le      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 4. Positions, opérations, pièces
-- -----------------------------------------------------------------------------
create table if not exists positions (
  id                 uuid primary key default gen_random_uuid(),
  portefeuille_id    uuid not null references portefeuilles(id),
  instrument_id      uuid not null references instruments(id),
  conservateur_id    uuid not null references conservateurs(id),
  compte_conservation text not null default '',
  identifiant_position text not null default '',          -- identifiant d'origine (ex. code avec suffixe du classeur)
  statut             text not null default 'active' check (statut in ('active','soldee','bloquee')),
  -- Valeurs tenues à jour par les règles (02_regles.sql) à partir des opérations validées.
  nominal_actuel     numeric(24,2) not null default 0,
  quantite_actuelle  numeric(24,6) not null default 0,
  -- Rapprochement avec le relevé du conservateur.
  nominal_releve     numeric(24,2),
  date_releve        date,
  cree_par           uuid references utilisateurs(id),
  cree_le            timestamptz not null default now(),
  version            int not null default 1,
  unique (portefeuille_id, instrument_id, conservateur_id, compte_conservation)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'classifications_position_fk') then
    alter table classifications add constraint classifications_position_fk
      foreign key (position_id) references positions(id) on delete cascade;
  end if;
end $$;

create table if not exists imports (
  id              uuid primary key default gen_random_uuid(),
  nom_fichier     text not null,
  empreinte       text not null,                       -- SHA-256 du fichier
  nature          text not null check (nature in ('base_titres','encaissements','echeancier_officiel')),
  correspondance  jsonb not null default '{}',
  lignes          jsonb not null default '[]',         -- données sources telles que lues (conservées)
  rapport         jsonb not null default '{}',
  statut          text not null default 'analyse' check (statut in ('analyse','importe','abandonne')),
  nb_lignes       int not null default 0,
  nb_importees    int not null default 0,
  nb_doublons     int not null default 0,
  nb_quarantaine  int not null default 0,
  cree_par        uuid references utilisateurs(id),
  cree_le         timestamptz not null default now(),
  importe_le      timestamptz
);

create sequence if not exists operations_numero;

create table if not exists operations (
  id                      uuid primary key default gen_random_uuid(),
  numero                  bigint not null unique default nextval('operations_numero'),
  type                    text not null check (type in ('position_ouverture','acquisition','cession','transfert',
                                                       'amortissement','remboursement','remboursement_anticipe')),
  position_id             uuid not null references positions(id),
  position_destination_id uuid references positions(id),
  date_effet              date not null,
  date_negociation        date,
  date_reglement          date,
  quantite                numeric(24,6) check (quantite is null or quantite >= 0),
  nominal                 numeric(24,2) not null check (nominal > 0),
  prix                    numeric(16,8),                -- prix en % du pair (ou montant unitaire selon l'unité)
  unite_cotation          text not null default 'pourcentage' check (unite_cotation in ('pourcentage','montant')),
  coupon_couru            numeric(24,2) not null default 0,
  frais                   numeric(24,2) not null default 0,
  montant_regle           numeric(24,2),
  contrepartie_id         uuid references contreparties(id),
  echeance_id             uuid,                         -- échéance réalisée (amortissement / remboursement)
  reference               text not null default '',
  commentaire             text not null default '',
  -- Circuit : brouillon → soumis → valide ou rejete → regle ; annule (avec opération corrective éventuelle).
  statut                  text not null default 'brouillon'
                          check (statut in ('brouillon','soumis','valide','rejete','regle','annule')),
  initiateur_id           uuid references utilisateurs(id),
  cree_le                 timestamptz not null default now(),
  soumis_le               timestamptz,
  validateur_id           uuid references utilisateurs(id),
  valide_le               timestamptz,
  motif_rejet             text,
  regle_par               uuid references utilisateurs(id),
  regle_le                timestamptz,
  annule_par              uuid references utilisateurs(id),
  annule_le               timestamptz,
  motif_annulation        text,
  operation_annulee_id    uuid references operations(id),  -- cette opération corrige celle-ci
  impact_retroactif       text,                             -- impact identifié d'une opération rétrodatée
  cle_import              text unique,                      -- empêche un import répété de créer deux fois l'opération
  import_id               uuid references imports(id),
  version                 int not null default 1,
  constraint operations_transfert check (
    (type = 'transfert' and position_destination_id is not null and position_destination_id <> position_id)
    or (type <> 'transfert' and position_destination_id is null))
);
create index if not exists operations_position on operations (position_id);
create index if not exists operations_destination on operations (position_destination_id);
create index if not exists operations_statut on operations (statut);

-- Pièces justificatives (fichiers de 4 Mo au plus, stockés dans la base).
create table if not exists pieces (
  id        uuid primary key default gen_random_uuid(),
  objet     text not null check (objet in ('operation','grevage','instrument','encaissement','arrete')),
  objet_id  uuid not null,
  nom       text not null,
  type_mime text not null default 'application/octet-stream',
  taille    int not null check (taille > 0 and taille <= 4194304),
  contenu   bytea not null,
  depose_par uuid references utilisateurs(id),
  depose_le timestamptz not null default now()
);
create index if not exists pieces_objet on pieces (objet, objet_id);

-- -----------------------------------------------------------------------------
-- 5. Échéances et encaissements
-- -----------------------------------------------------------------------------
create table if not exists echeances (
  id                    uuid primary key default gen_random_uuid(),
  position_id           uuid not null references positions(id) on delete cascade,
  date_contractuelle    date not null,
  date_reglement_prevue date not null,
  debut_periode         date not null,
  fin_periode           date not null,
  crd_debut             numeric(24,2) not null default 0,
  capital_du            numeric(24,2) not null default 0,
  interet_brut          numeric(24,2) not null default 0,
  retenue               numeric(24,2) not null default 0,
  net_attendu           numeric(24,2) not null default 0,
  source                text not null default 'genere' check (source in ('genere','officiel')),
  version_moteur        text not null,
  empreinte_parametres  text not null default '',       -- caractéristiques ayant produit l'échéance
  statut_manuel         text check (statut_manuel in ('litige','annulee','remplacee')),
  motif_statut          text,
  explication_ecart     text,
  genere_le             timestamptz not null default now(),
  unique (position_id, date_contractuelle)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'operations_echeance_fk') then
    alter table operations add constraint operations_echeance_fk
      foreign key (echeance_id) references echeances(id) on delete set null;
  end if;
end $$;

create table if not exists encaissements (
  id           uuid primary key default gen_random_uuid(),
  position_id  uuid not null references positions(id),
  echeance_id  uuid references echeances(id) on delete restrict,
  date_valeur  date not null,
  montant      numeric(24,2) not null check (montant > 0),
  nature       text not null default 'mixte' check (nature in ('capital','interet','mixte')),
  reference    text not null default '',
  commentaire  text not null default '',
  statut       text not null default 'actif' check (statut in ('actif','annule')),
  motif_annulation text,
  cle_import   text unique,
  import_id    uuid references imports(id),
  saisi_par    uuid references utilisateurs(id),
  saisi_le     timestamptz not null default now()
);
create index if not exists encaissements_echeance on encaissements (echeance_id);

-- -----------------------------------------------------------------------------
-- 6. Grevage (affectation en garantie)
-- -----------------------------------------------------------------------------
create table if not exists grevages (
  id                    uuid primary key default gen_random_uuid(),
  position_id           uuid not null references positions(id),
  beneficiaire_id       uuid not null references contreparties(id),
  nominal_affecte       numeric(24,2) not null check (nominal_affecte > 0),
  decote_pct            numeric(8,6) check (decote_pct is null or (decote_pct >= 0 and decote_pct < 1)),
  valeur_retenue        numeric(24,2),     -- valeur admise en garantie (après décote) : mesure distincte du nominal
  financement_obtenu    numeric(24,2),     -- montant emprunté : jamais soustrait du nominal
  date_debut            date not null,
  date_fin              date,
  reference_convention  text not null default '',
  commentaire           text not null default '',
  statut                text not null default 'brouillon' check (statut in ('brouillon','soumis','actif','rejete','leve')),
  initiateur_id         uuid references utilisateurs(id),
  cree_le               timestamptz not null default now(),
  validateur_id         uuid references utilisateurs(id),
  valide_le             timestamptz,
  motif_rejet           text,
  leve_par              uuid references utilisateurs(id),
  leve_le               timestamptz,
  motif_levee           text,
  version               int not null default 1,
  constraint grevages_dates check (date_fin is null or date_fin >= date_debut)
);
create index if not exists grevages_position on grevages (position_id);

create table if not exists mouvements_grevage (
  id            bigint generated always as identity primary key,
  grevage_id    uuid not null references grevages(id) on delete cascade,
  type          text not null check (type in ('creation','augmentation','reduction','mainlevee')),
  nominal_avant numeric(24,2) not null,
  nominal_apres numeric(24,2) not null,
  date          date not null,
  motif         text not null default '',
  auteur_id     uuid references utilisateurs(id),
  cree_le       timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 7. Arrêtés (photographies validées du portefeuille)
-- -----------------------------------------------------------------------------
create table if not exists arretes (
  id                uuid primary key default gen_random_uuid(),
  date_arrete       date not null unique,
  statut            text not null default 'ouvert' check (statut in ('ouvert','verrouille','rouvert')),
  resultat          jsonb not null default '{}',   -- situation complète figée (positions, totaux, paramètres)
  version_moteur    text not null default '',
  cree_par          uuid references utilisateurs(id),
  cree_le           timestamptz not null default now(),
  verrouille_par    uuid references utilisateurs(id),
  verrouille_le     timestamptz,
  rouvert_par       uuid references utilisateurs(id),
  rouvert_le        timestamptz,
  motif_reouverture text
);

-- -----------------------------------------------------------------------------
-- 8. Contrôles : quarantaine d'import et suivi des alertes
-- -----------------------------------------------------------------------------
-- Ligne d'import placée en quarantaine (anomalie héritée) : jamais corrigée automatiquement.
create table if not exists quarantaine (
  id           uuid primary key default gen_random_uuid(),
  import_id    uuid not null references imports(id),
  numero_ligne int not null,
  donnees      jsonb not null,
  motif        text not null,
  statut       text not null default 'ouverte' check (statut in ('ouverte','corrigee','rejetee')),
  commentaire  text not null default '',
  traite_par   uuid references utilisateurs(id),
  traite_le    timestamptz
);

-- Suivi des contrôles calculés (clé stable produite par le moteur) : responsable et statut de traitement.
create table if not exists suivi_controles (
  cle            text primary key,
  statut         text not null default 'nouveau' check (statut in ('nouveau','en_cours','traite','accepte')),
  responsable_id uuid references utilisateurs(id),
  commentaire    text not null default '',
  modifie_par    uuid references utilisateurs(id),
  modifie_le     timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 9. Journal des actions et audit des données (ajout seul)
-- -----------------------------------------------------------------------------
create table if not exists journal (
  id              bigint generated always as identity primary key,
  date            timestamptz not null default now(),
  utilisateur_id  uuid references utilisateurs(id),
  utilisateur_nom text not null default '',
  action          text not null,
  objet           text not null default '',
  objet_id        text not null default '',
  details         jsonb not null default '{}'
);
create index if not exists journal_date on journal (date desc);

-- Ancienne et nouvelle valeur de chaque ligne modifiée (rempli automatiquement par les règles).
create table if not exists audit (
  id             bigint generated always as identity primary key,
  date           timestamptz not null default now(),
  utilisateur_id uuid,
  table_nom      text not null,
  ligne_id       text not null,
  operation      text not null check (operation in ('INSERT','UPDATE','DELETE')),
  ancien         jsonb,
  nouveau        jsonb
);
create index if not exists audit_ligne on audit (table_nom, ligne_id);
create index if not exists audit_date on audit (date desc);

-- Inventaire des tables de Titrix (30 attendues).
select table_name as "Tables Titrix" from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name;
