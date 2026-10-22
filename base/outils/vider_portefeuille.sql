-- =============================================================================
-- TITRIX — Outil : vider le portefeuille (démonstration et essais) avant le démarrage réel
-- =============================================================================
-- Efface TOUTES les données de portefeuille : instruments, positions, opérations, échéances,
-- encaissements, grevages, arrêtés, imports, pièces, alertes suivies.
-- CONSERVE : les comptes utilisateurs, les paramètres, les pays, devises, types d'instruments,
-- tranches de maturité, jours fériés, portefeuilles, et vos propres conservateurs / émetteurs /
-- contreparties. Retire les référentiels fictifs (noms contenant « Démo ») et désactive les deux
-- comptes fictifs de la démonstration. Le journal et l'audit sont conservés (traçabilité).
--
-- IRRÉVERSIBLE : à n'utiliser qu'AVANT d'y mettre de vraies données.
-- Neon → SQL Editor → nouvelle requête (bouton ⊕, pas l'Historique) → coller → Run.
-- Tout se fait en une seule instruction : soit tout est effacé, soit rien.
-- =============================================================================
do $$
declare
  t text;
  tables_protegees text[] := array['operations','grevages','mouvements_grevage','arretes','encaissements',
    'echeances','positions','instruments','echeancier_officiel','classifications','pieces','imports',
    'quarantaine','suivi_controles','emetteurs','conservateurs','contreparties','utilisateurs','parametres'];
  bilan text;
begin
  -- Les règles de gestion interdisent (à juste titre) d'effacer des opérations validées ou un arrêté
  -- verrouillé : elles sont suspendues le temps de ce nettoyage, puis rétablies.
  foreach t in array tables_protegees loop
    execute format('alter table %I disable trigger user', t);
  end loop;

  select format('%s instrument(s), %s position(s), %s opération(s), %s encaissement(s), %s grevage(s), %s arrêté(s), %s import(s)',
           (select count(*) from instruments), (select count(*) from positions), (select count(*) from operations),
           (select count(*) from encaissements), (select count(*) from grevages), (select count(*) from arretes),
           (select count(*) from imports))
    into bilan;

  delete from encaissements;
  delete from pieces;
  delete from operations;
  delete from mouvements_grevage;
  delete from grevages;
  delete from echeances;
  delete from classifications;
  delete from echeancier_officiel;
  delete from positions;
  delete from instruments;
  delete from arretes;
  delete from quarantaine;
  delete from imports;
  delete from suivi_controles;

  -- Référentiels fictifs de la démonstration.
  delete from emetteurs where nom ilike '%démo%';
  delete from conservateurs where nom ilike '%démo%';
  delete from contreparties where nom ilike '%démo%';
  -- Comptes fictifs : désactivés (ils restent cités dans le journal).
  update utilisateurs set actif = false where email like '%@titrix.demo';
  delete from sessions where utilisateur_id in (select id from utilisateurs where email like '%@titrix.demo');
  update parametres set valeur = 'Établissement' where cle = 'nom_etablissement' and valeur = 'Banque Démo SA';

  foreach t in array tables_protegees loop
    execute format('alter table %I enable trigger user', t);
  end loop;

  insert into journal (utilisateur_nom, action, objet, details)
  values ('Console Neon', 'Portefeuille vidé avant démarrage (outil vider_portefeuille.sql)', 'base', jsonb_build_object('efface', bilan));
  raise notice 'Effacé : %', bilan;
end $$;

-- Contrôle : tout doit être à 0, et regles = 41 (règles rétablies).
select (select count(*) from instruments) as instruments,
       (select count(*) from positions) as positions,
       (select count(*) from operations) as operations,
       (select count(*) from arretes) as arretes,
       (select count(*) from imports) as imports,
       (select count(*) from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
         where not tg.tgisinternal and n.nspname = 'public' and tg.tgenabled = 'O') as regles;
