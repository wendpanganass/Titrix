-- =============================================================================
-- TITRIX — Script 3 sur 3 : référentiels et paramètres de départ
-- =============================================================================
-- À exécuter APRÈS 02_regles.sql. Rejouable : n'écrase jamais une valeur déjà modifiée.
-- Le premier compte administrateur ne se crée PAS ici : ouvrez l'application, elle
-- propose l'écran « Installation » tant qu'aucun compte n'existe (aucun mot de passe dans ce fichier).
-- =============================================================================

insert into parametres (cle, valeur, description) values
  ('devise_reference',        'XOF',        'Devise de référence affichée par défaut dans les tableaux de bord'),
  ('seuils_alerte_echeance',  '30,15,7,0',  'Alertes d''échéance en jours avant la date prévue (J-30, J-15, J-7, jour J)'),
  ('tolerance_encaissement',  '5',          'Délai de tolérance (jours) avant qu''une échéance non reçue passe « en retard »'),
  ('limite_concentration',    '',           'Limite de concentration par émetteur en % de l''encours (vide = désactivée)'),
  ('horizon_projection_mois', '60',         'Horizon par défaut de l''écran Échéancier (mois) ; les flux au-delà sont affichés à part'),
  ('convention_defaut',       'ACT/365',    'Convention proposée à la création d''un instrument (chaque instrument porte la sienne : elle prévaut)'),
  ('duree_session_heures',    '10',         'Durée maximale d''une session de connexion (heures)'),
  ('nom_etablissement',       'Établissement', 'Nom affiché dans l''en-tête des états et exports')
on conflict (cle) do nothing;

insert into devises (code, libelle, decimales) values
  ('XOF', 'Franc CFA (BCEAO)', 0),
  ('XAF', 'Franc CFA (BEAC)', 0),
  ('EUR', 'Euro', 2),
  ('USD', 'Dollar américain', 2),
  ('GHS', 'Cedi ghanéen', 2),
  ('NGN', 'Naira nigérian', 2),
  ('MAD', 'Dirham marocain', 2)
on conflict (code) do nothing;

insert into pays (code, nom, zone) values
  ('BF', 'Burkina Faso', 'UEMOA'),
  ('BJ', 'Bénin', 'UEMOA'),
  ('CI', 'Côte d''Ivoire', 'UEMOA'),
  ('GW', 'Guinée-Bissau', 'UEMOA'),
  ('ML', 'Mali', 'UEMOA'),
  ('NE', 'Niger', 'UEMOA'),
  ('SN', 'Sénégal', 'UEMOA'),
  ('TG', 'Togo', 'UEMOA'),
  ('CM', 'Cameroun', 'CEMAC'),
  ('GA', 'Gabon', 'CEMAC'),
  ('CG', 'Congo', 'CEMAC'),
  ('TD', 'Tchad', 'CEMAC'),
  ('CF', 'République centrafricaine', 'CEMAC'),
  ('GQ', 'Guinée équatoriale', 'CEMAC'),
  ('FR', 'France', 'Zone euro'),
  ('MA', 'Maroc', 'Afrique du Nord')
on conflict (code) do nothing;

insert into types_instrument (code, libelle, precompte) values
  ('OAT', 'Obligation assimilable du Trésor', false),
  ('BAT', 'Bon assimilable du Trésor (intérêts précomptés)', true),
  ('OBL', 'Obligation (emprunt par appel public à l''épargne)', false),
  ('OBS', 'Obligation de société', false),
  ('SUKUK', 'Sukuk', false)
on conflict (code) do nothing;

insert into tranches_maturite (libelle, borne_min, borne_max, ordre) values
  ('Moins d''un mois', 1, 31, 1),
  ('1 à 3 mois', 31, 92, 2),
  ('3 à 6 mois', 92, 183, 3),
  ('6 à 12 mois', 183, 366, 4),
  ('1 à 2 ans', 366, 731, 5),
  ('Plus de 2 ans', 731, null, 6)
on conflict (libelle) do nothing;

insert into entites (nom) values ('Siège') on conflict (nom) do nothing;

insert into portefeuilles (code, libelle, entite_id)
select 'PF-INV', 'Portefeuille d''investissement', id from entites where nom = 'Siège'
on conflict (code) do nothing;

select 'Référentiels Titrix initialisés. Ouvrez maintenant l''application pour créer le premier administrateur.' as resultat;
