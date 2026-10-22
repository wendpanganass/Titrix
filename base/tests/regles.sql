-- =============================================================================
-- TITRIX — Tests des règles de gestion de la base (contrôles bloquants du cahier des charges §9.2)
-- =============================================================================
-- À lancer sur une base de TEST (jamais en production), après 01, 02 et 03 :
--   psql "$DATABASE_URL_TEST" -v ON_ERROR_STOP=1 -f base/tests/regles.sql
-- Tout se passe dans une transaction annulée à la fin : la base n'est pas modifiée.
-- Message final attendu : « TOUS LES TESTS DES RÈGLES SONT PASSÉS ».
-- =============================================================================
begin;

-- Outils de test --------------------------------------------------------------
create function pg_temp.agir(u uuid) returns void language sql as $$ select set_config('app.utilisateur_id', u::text, true) $$;

-- Exécute une instruction qui DOIT être refusée avec un message contenant « attendu ».
create function pg_temp.refuse(instruction text, attendu text) returns void language plpgsql as $$
begin
  begin
    execute instruction;
  exception when others then
    if position(attendu in sqlerrm) = 0 then
      raise exception 'ÉCHEC : message inattendu pour [%] : %', instruction, sqlerrm;
    end if;
    raise notice 'OK refusé : %', attendu;
    return;
  end;
  raise exception 'ÉCHEC : [%] aurait dû être refusé (%)', instruction, attendu;
end $$;

create function pg_temp.verifier(condition boolean, libelle text) returns void language plpgsql as $$
begin
  if not condition then raise exception 'ÉCHEC : %', libelle; end if;
  raise notice 'OK : %', libelle;
end $$;

-- Jeu d'essai fictif ------------------------------------------------------------
insert into utilisateurs (id, email, nom, roles, mot_de_passe_hash) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@demo.test', 'Admin Démo', array['admin'], 'x'),
  ('00000000-0000-0000-0000-00000000000b', 'gestion@demo.test', 'Gestion Démo', array['gestionnaire','back_office'], 'x'),
  ('00000000-0000-0000-0000-00000000000c', 'valid@demo.test', 'Validation Démo', array['validateur'], 'x');

select pg_temp.agir('00000000-0000-0000-0000-00000000000b');
insert into conservateurs (id, nom) values ('10000000-0000-0000-0000-000000000001', 'SGI Démo A'), ('10000000-0000-0000-0000-000000000002', 'SGI Démo B');
insert into contreparties (id, nom) values ('20000000-0000-0000-0000-000000000001', 'Banque centrale Démo');
insert into instruments (id, code_interne, libelle, devise_code, nominal_unitaire, date_emission, date_echeance, taux_coupon, frequence, profil)
values ('30000000-0000-0000-0000-000000000001', 'DEMO-2029', 'Obligation démo 6,5 % 2029', 'XOF', 10000, '2024-03-15', '2029-03-15', 0.065, 1, 'in_fine');
insert into positions (id, portefeuille_id, instrument_id, conservateur_id) values
  ('40000000-0000-0000-0000-000000000001', (select id from portefeuilles where code = 'PF-INV'), '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002', (select id from portefeuilles where code = 'PF-INV'), '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002');

-- 1. Validation des caractéristiques par une autre personne que l'auteur --------
select pg_temp.refuse($$update instruments set statut = 'valide' where code_interne = 'DEMO-2029'$$, 'seul un profil « validateur »');
select pg_temp.agir('00000000-0000-0000-0000-00000000000c');
update instruments set statut = 'valide' where code_interne = 'DEMO-2029';
select pg_temp.verifier((select statut from instruments where code_interne = 'DEMO-2029') = 'valide', 'instrument validé par un validateur');
select pg_temp.agir('00000000-0000-0000-0000-00000000000b');
update instruments set taux_coupon = 0.07 where code_interne = 'DEMO-2029';
select pg_temp.verifier((select statut from instruments where code_interne = 'DEMO-2029') = 'a_valider', 'une modification remet l''instrument à valider');
select pg_temp.agir('00000000-0000-0000-0000-00000000000c');
update instruments set taux_coupon = 0.065 where code_interne = 'DEMO-2029';
select pg_temp.refuse($$update instruments set statut = 'valide' where code_interne = 'DEMO-2029'$$, 'autre personne que leur auteur');
select pg_temp.agir('00000000-0000-0000-0000-00000000000b');
update instruments set statut = 'a_valider' where code_interne = 'DEMO-2029';

-- 2. Opération sans données obligatoires ---------------------------------------
select pg_temp.refuse($$insert into operations (type, position_id, date_effet, nominal, statut) values ('acquisition', '40000000-0000-0000-0000-000000000001', '2024-03-15', 1000000, 'soumis')$$, 'Opération incomplète');
select pg_temp.refuse($$insert into operations (type, position_id, date_effet, nominal, statut) values ('acquisition', '40000000-0000-0000-0000-000000000001', '2024-03-15', 1000000, 'valide')$$, 'jamais directement validée');

-- 3. Validation par l'initiateur ------------------------------------------------
insert into operations (id, type, position_id, date_effet, nominal, quantite, statut)
values ('50000000-0000-0000-0000-000000000001', 'position_ouverture', '40000000-0000-0000-0000-000000000001', '2024-03-15', 1000000, 100, 'soumis');
select pg_temp.refuse($$update operations set statut = 'valide' where id = '50000000-0000-0000-0000-000000000001'$$, 'seul un profil « validateur »');
select pg_temp.agir('00000000-0000-0000-0000-00000000000c');
update operations set statut = 'valide' where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.verifier((select nominal_actuel from positions where id = '40000000-0000-0000-0000-000000000001') = 1000000, 'position recalculée à 1 000 000 après validation');

-- Un validateur qui saisit ne valide pas sa propre opération.
update utilisateurs set roles = array['validateur','gestionnaire'] where id = '00000000-0000-0000-0000-00000000000c';
insert into operations (id, type, position_id, date_effet, nominal, statut)
values ('50000000-0000-0000-0000-000000000009', 'remboursement_anticipe', '40000000-0000-0000-0000-000000000001', '2025-01-10', 1000, 'soumis');
select pg_temp.refuse($$update operations set statut = 'valide' where id = '50000000-0000-0000-0000-000000000009'$$, 'par son initiateur');
update operations set statut = 'annule', motif_annulation = 'test' where id = '50000000-0000-0000-0000-000000000009';
update utilisateurs set roles = array['validateur'] where id = '00000000-0000-0000-0000-00000000000c';

-- 4. Contenu figé après validation ------------------------------------------------
select pg_temp.refuse($$update operations set nominal = 2000000 where id = '50000000-0000-0000-0000-000000000001'$$, 'ne peut plus être modifiée');
select pg_temp.refuse($$delete from operations where id = '50000000-0000-0000-0000-000000000001'$$, 'ne peut pas être supprimée');

-- 5. Nominal détenu négatif ------------------------------------------------------
select pg_temp.agir('00000000-0000-0000-0000-00000000000b');
insert into operations (id, type, position_id, date_effet, date_negociation, date_reglement, nominal, prix, contrepartie_id, statut)
values ('50000000-0000-0000-0000-000000000002', 'cession', '40000000-0000-0000-0000-000000000001', '2025-06-01', '2025-05-29', '2025-06-01', 1500000, 100, '20000000-0000-0000-0000-000000000001', 'soumis');
select pg_temp.agir('00000000-0000-0000-0000-00000000000c');
select pg_temp.refuse($$update operations set statut = 'valide' where id = '50000000-0000-0000-0000-000000000002'$$, 'deviendrait négatif');

-- 6. Transfert entre conservateurs (ni achat ni vente) ---------------------------
select pg_temp.agir('00000000-0000-0000-0000-00000000000b');
insert into operations (id, type, position_id, position_destination_id, date_effet, nominal, statut)
values ('50000000-0000-0000-0000-000000000003', 'transfert', '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', '2025-02-01', 300000, 'soumis');
select pg_temp.agir('00000000-0000-0000-0000-00000000000c');
update operations set statut = 'valide' where id = '50000000-0000-0000-0000-000000000003';
select pg_temp.verifier((select nominal_actuel from positions where id = '40000000-0000-0000-0000-000000000001') = 700000
  and (select nominal_actuel from positions where id = '40000000-0000-0000-0000-000000000002') = 300000, 'transfert : 700 000 chez A, 300 000 chez B');

-- 7. Grevage supérieur au disponible -----------------------------------------------
select pg_temp.agir('00000000-0000-0000-0000-00000000000b');
insert into grevages (id, position_id, beneficiaire_id, nominal_affecte, financement_obtenu, date_debut, statut)
values ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 800000, 500000, '2025-03-01', 'soumis');
select pg_temp.agir('00000000-0000-0000-0000-00000000000c');
select pg_temp.refuse($$update grevages set statut = 'actif' where id = '60000000-0000-0000-0000-000000000001'$$, 'grevage supérieur au nominal disponible');
select pg_temp.agir('00000000-0000-0000-0000-00000000000b');
insert into grevages (id, position_id, beneficiaire_id, nominal_affecte, date_debut, statut)
values ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 400000, '2025-03-01', 'soumis');
select pg_temp.refuse($$update grevages set statut = 'actif' where id = '60000000-0000-0000-0000-000000000002'$$, 'seul un profil « validateur »');
select pg_temp.agir('00000000-0000-0000-0000-00000000000c');
update grevages set statut = 'actif' where id = '60000000-0000-0000-0000-000000000002';
select pg_temp.refuse($$update grevages set nominal_affecte = 900000 where id = '60000000-0000-0000-0000-000000000002'$$, 'grevage supérieur au nominal disponible');
-- Une cession qui ferait passer le détenu sous le grevé est bloquée.
select pg_temp.agir('00000000-0000-0000-0000-00000000000b');
insert into operations (id, type, position_id, date_effet, date_negociation, date_reglement, nominal, prix, contrepartie_id, statut)
values ('50000000-0000-0000-0000-000000000004', 'cession', '40000000-0000-0000-0000-000000000001', '2025-07-01', '2025-06-28', '2025-07-01', 400000, 99.5, '20000000-0000-0000-0000-000000000001', 'soumis');
select pg_temp.agir('00000000-0000-0000-0000-00000000000c');
select pg_temp.refuse($$update operations set statut = 'valide' where id = '50000000-0000-0000-0000-000000000004'$$, 'nominal grevé actif');

-- 8. Arrêté verrouillé ---------------------------------------------------------------
select pg_temp.agir('00000000-0000-0000-0000-00000000000a');
insert into arretes (id, date_arrete, resultat) values ('70000000-0000-0000-0000-000000000001', '2025-12-31', '{"lignes":[]}');
select pg_temp.agir('00000000-0000-0000-0000-00000000000c');
update arretes set statut = 'verrouille' where id = '70000000-0000-0000-0000-000000000001';
select pg_temp.refuse($$update arretes set resultat = '{}' where id = '70000000-0000-0000-0000-000000000001'$$, 'Arrêté verrouillé');
select pg_temp.refuse($$delete from arretes where id = '70000000-0000-0000-0000-000000000001'$$, 'ne peut pas être supprimé');
select pg_temp.agir('00000000-0000-0000-0000-00000000000b');
insert into operations (id, type, position_id, date_effet, nominal, statut)
values ('50000000-0000-0000-0000-000000000005', 'remboursement_anticipe', '40000000-0000-0000-0000-000000000001', '2025-11-30', 100000, 'soumis');
select pg_temp.agir('00000000-0000-0000-0000-00000000000c');
select pg_temp.refuse($$update operations set statut = 'valide' where id = '50000000-0000-0000-0000-000000000005'$$, 'est verrouillé');
select pg_temp.refuse($$update arretes set statut = 'rouvert' where id = '70000000-0000-0000-0000-000000000001'$$, 'motif de la réouverture');
update arretes set statut = 'rouvert', motif_reouverture = 'Opération rétrodatée à intégrer' where id = '70000000-0000-0000-0000-000000000001';
update operations set statut = 'valide' where id = '50000000-0000-0000-0000-000000000005';
select pg_temp.verifier((select nominal_actuel from positions where id = '40000000-0000-0000-0000-000000000001') = 600000, 'opération rétrodatée intégrée après réouverture');

-- 9. Journal et audit en ajout seul --------------------------------------------------------
insert into journal (utilisateur_nom, action) values ('Test', 'Essai');
select pg_temp.refuse($$update journal set action = 'x'$$, 'ajout seul');
select pg_temp.refuse($$delete from audit$$, 'ajout seul');
select pg_temp.verifier((select count(*) from audit where table_nom = 'operations' and ligne_id = '50000000-0000-0000-0000-000000000001' and operation = 'UPDATE'
  and ancien->>'statut' = 'soumis' and nouveau->>'statut' = 'valide' and utilisateur_id = '00000000-0000-0000-0000-00000000000c') = 1,
  'audit : auteur, ancienne et nouvelle valeur de la validation');

-- 10. Toujours un administrateur actif ------------------------------------------------------
-- (les autres administrateurs éventuels de la base sont désactivés le temps du test, annulé à la fin)
update utilisateurs set actif = false where 'admin' = any(roles) and id <> '00000000-0000-0000-0000-00000000000a';
select pg_temp.refuse($$update utilisateurs set actif = false where id = '00000000-0000-0000-0000-00000000000a'$$, 'au moins un administrateur');

-- 11. Écriture sans identité (console) refusée pour une action sensible ----------------------
select set_config('app.utilisateur_id', '', true);
select pg_temp.refuse($$insert into operations (type, position_id, date_effet, nominal) values ('acquisition', '40000000-0000-0000-0000-000000000001', '2025-01-01', 10)$$, 'utilisateur non identifié');

select 'TOUS LES TESTS DES RÈGLES SONT PASSÉS' as resultat;
rollback;
