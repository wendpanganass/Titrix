-- =============================================================================
-- TITRIX — Script 2 sur 3 : règles de gestion appliquées par la base
-- =============================================================================
-- À exécuter APRÈS 01_tables.sql (Neon → SQL Editor → coller → Run). Rejouable.
--
-- Pourquoi des règles dans la base ? Pour qu'aucun écran, import ou erreur de programmation
-- ne puisse contourner les contrôles bloquants du cahier des charges (§9.2) :
--   * quantité / nominal détenu négatif ;
--   * grevage supérieur au nominal disponible ;
--   * opération sans données obligatoires ;
--   * validation par l'initiateur ;
--   * modification d'un arrêté verrouillé sans procédure de réouverture ;
-- et pour tracer automatiquement chaque modification (auteur, date, ancienne et nouvelle valeur).
--
-- L'application indique à la base qui agit : au début de chaque transaction elle exécute
--   select set_config('app.utilisateur_id', '<identifiant du compte>', true);
-- Une écriture faite sans cette information (directement dans la console) est refusée
-- pour les actions sensibles (validation, levée, verrouillage…).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fonctions d'aide
-- -----------------------------------------------------------------------------
create or replace function utilisateur_courant() returns uuid
language sql stable as $$
  select nullif(current_setting('app.utilisateur_id', true), '')::uuid
$$;

create or replace function a_role(r text) returns boolean
language sql stable as $$
  select exists (select 1 from utilisateurs u
                 where u.id = utilisateur_courant() and u.actif and r = any(u.roles))
$$;

create or replace function exiger_utilisateur() returns uuid
language plpgsql stable as $$
declare u uuid := utilisateur_courant();
begin
  if u is null then
    raise exception 'Action réservée à l''application Titrix (utilisateur non identifié).' using errcode = 'P0001';
  end if;
  return u;
end $$;

create or replace function exiger_role(r text, libelle text) returns void
language plpgsql stable as $$
begin
  perform exiger_utilisateur();
  if not a_role(r) then
    raise exception 'Droits insuffisants : seul un profil « % » peut %.', r, libelle using errcode = 'P0001';
  end if;
end $$;

-- Date du dernier arrêté verrouillé (null s'il n'y en a pas).
create or replace function date_dernier_verrou() returns date
language sql stable as $$
  select max(date_arrete) from arretes where statut = 'verrouille'
$$;

create or replace function controler_verrou(d date, quoi text) returns void
language plpgsql stable as $$
declare v date := date_dernier_verrou();
begin
  if v is not null and d <= v then
    raise exception 'L''arrêté du % est verrouillé : % datée du % le modifierait. Rouvrez d''abord l''arrêté (procédure de réouverture).',
      to_char(v, 'DD/MM/YYYY'), quoi, to_char(d, 'DD/MM/YYYY') using errcode = 'P0001';
  end if;
end $$;

-- Effet d'une opération sur le nominal détenu d'une position (même règle que le moteur, fichier 03).
create or replace function effet_nominal(o operations, p uuid) returns numeric
language sql immutable as $$
  select case
    when o.statut not in ('valide','regle') then 0
    when o.type in ('position_ouverture','acquisition') and o.position_id = p then o.nominal
    when o.type in ('cession','remboursement_anticipe','amortissement','remboursement') and o.position_id = p then -o.nominal
    when o.type = 'transfert' and o.position_id = p then -o.nominal
    when o.type = 'transfert' and o.position_destination_id = p then o.nominal
    else 0 end
$$;

create or replace function effet_quantite(o operations, p uuid) returns numeric
language sql immutable as $$
  select case
    when o.statut not in ('valide','regle') or o.quantite is null then 0
    when o.type in ('position_ouverture','acquisition') and o.position_id = p then o.quantite
    when o.type in ('cession','remboursement_anticipe') and o.position_id = p then -o.quantite
    when o.type = 'transfert' and o.position_id = p then -o.quantite
    when o.type = 'transfert' and o.position_destination_id = p then o.quantite
    else 0 end
$$;

-- Nominal grevé actif d'une position (grevages validés, non levés, à la date du jour).
create or replace function nominal_greve_actif(p uuid, sauf uuid default null) returns numeric
language sql stable as $$
  select coalesce(sum(nominal_affecte), 0) from grevages
  where position_id = p and statut = 'actif' and (date_fin is null or date_fin > current_date)
    and (sauf is null or id <> sauf)
$$;

-- -----------------------------------------------------------------------------
-- 2. Recalcul et contrôle d'une position (nominal jamais négatif, grevé ≤ détenu)
-- -----------------------------------------------------------------------------
create or replace function recalculer_position(p uuid) returns void
language plpgsql as $$
declare
  courant numeric := 0;
  qte numeric := 0;
  minimum numeric := 0;
  date_min date;
  r record;
  greve numeric;
  statut_pos text;
begin
  -- Verrou de ligne : deux modifications simultanées d'une même position sont traitées l'une après l'autre.
  select statut into statut_pos from positions where id = p for update;
  for r in
    select o.date_effet, sum(effet_nominal(o, p)) as dn, sum(effet_quantite(o, p)) as dq
    from operations o
    where (o.position_id = p or o.position_destination_id = p) and o.statut in ('valide','regle')
    group by o.date_effet order by o.date_effet
  loop
    courant := courant + r.dn;
    qte := qte + r.dq;
    if courant < minimum - 0.005 then minimum := courant; date_min := r.date_effet; end if;
  end loop;
  if minimum < -0.005 then
    raise exception 'Contrôle bloquant : le nominal détenu deviendrait négatif (% au %). Vérifiez la date et le montant de l''opération.',
      to_char(minimum, 'FM999G999G999G990D00'), to_char(date_min, 'DD/MM/YYYY') using errcode = 'P0001';
  end if;
  greve := nominal_greve_actif(p);
  if greve > courant + 0.005 then
    raise exception 'Contrôle bloquant : le nominal grevé actif (%) dépasserait le nominal détenu (%). Levez ou réduisez d''abord le grevage.',
      to_char(greve, 'FM999G999G999G990D00'), to_char(courant, 'FM999G999G999G990D00') using errcode = 'P0001';
  end if;
  update positions set
    nominal_actuel = round(courant, 2),
    quantite_actuelle = qte,
    statut = case when statut_pos = 'bloquee' then 'bloquee' when round(courant, 2) = 0 then 'soldee' else 'active' end
  where id = p;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Opérations : données obligatoires, circuit de validation, arrêtés verrouillés
-- -----------------------------------------------------------------------------
create or replace function controler_obligatoires_operation(o operations) returns void
language plpgsql stable as $$
declare manque text[] := '{}'; inst uuid; inst_dest uuid;
begin
  if o.date_effet is null then manque := array_append(manque, 'date d''effet'); end if;
  if o.nominal is null or o.nominal <= 0 then manque := array_append(manque, 'nominal'); end if;
  if o.type in ('acquisition','cession') then
    if o.date_negociation is null then manque := array_append(manque, 'date de négociation'); end if;
    if o.date_reglement is null then manque := array_append(manque, 'date de règlement'); end if;
    if o.prix is null then manque := array_append(manque, 'prix'); end if;
    if o.contrepartie_id is null then manque := array_append(manque, 'contrepartie'); end if;
  end if;
  if o.type = 'transfert' then
    select instrument_id into inst from positions where id = o.position_id;
    select instrument_id into inst_dest from positions where id = o.position_destination_id;
    if inst_dest is null then manque := array_append(manque, 'position de destination');
    elsif inst <> inst_dest then
      raise exception 'Un transfert doit concerner le même instrument chez deux conservateurs.' using errcode = 'P0001';
    end if;
  end if;
  if array_length(manque, 1) > 0 then
    raise exception 'Opération incomplète : % manquant(e)s.', array_to_string(manque, ', ') using errcode = 'P0001';
  end if;
end $$;

create or replace function regles_operation() returns trigger
language plpgsql as $$
declare u uuid := utilisateur_courant();
begin
  if tg_op = 'INSERT' then
    if new.statut not in ('brouillon','soumis') then
      raise exception 'Une opération est créée en brouillon ou soumise, jamais directement validée.' using errcode = 'P0001';
    end if;
    new.initiateur_id := coalesce(new.initiateur_id, exiger_utilisateur());
    if new.statut = 'soumis' then
      perform controler_obligatoires_operation(new);
      new.soumis_le := now();
    end if;
    return new;
  end if;

  -- Contenu figé dès que l'opération quitte le brouillon (on annule et on corrige, on ne réécrit pas).
  if old.statut not in ('brouillon','rejete') and (
       new.type, new.position_id, new.position_destination_id, new.date_effet, new.date_negociation, new.date_reglement,
       new.quantite, new.nominal, new.prix, new.coupon_couru, new.frais, new.montant_regle, new.contrepartie_id, new.initiateur_id)
     is distinct from (
       old.type, old.position_id, old.position_destination_id, old.date_effet, old.date_negociation, old.date_reglement,
       old.quantite, old.nominal, old.prix, old.coupon_couru, old.frais, old.montant_regle, old.contrepartie_id, old.initiateur_id)
     and not (old.statut = 'valide' and new.statut = 'regle'
              and (new.date_reglement, new.montant_regle) is distinct from (old.date_reglement, old.montant_regle)
              and (new.type, new.position_id, new.nominal, new.date_effet) is not distinct from (old.type, old.position_id, old.nominal, old.date_effet))
  then
    raise exception 'Une opération soumise ou validée ne peut plus être modifiée : annulez-la et saisissez une opération corrective.'
      using errcode = 'P0001';
  end if;

  if new.statut is distinct from old.statut then
    -- Transitions autorisées du circuit Brouillon → Soumis → Validé ou Rejeté → Réglé (+ annulation).
    if not ((old.statut, new.statut) in (('brouillon','soumis'), ('rejete','brouillon'), ('soumis','brouillon'),
            ('soumis','valide'), ('soumis','rejete'), ('valide','regle'), ('valide','annule'), ('regle','annule'),
            ('brouillon','annule'), ('rejete','annule'), ('soumis','annule'))) then
      raise exception 'Passage du statut « % » au statut « % » non autorisé.', old.statut, new.statut using errcode = 'P0001';
    end if;

    if new.statut = 'soumis' then
      perform controler_obligatoires_operation(new);
      new.soumis_le := now();
    elsif new.statut in ('valide','rejete') then
      perform exiger_role('validateur', 'approuver ou rejeter une opération');
      if u = old.initiateur_id then
        raise exception 'Contrôle bloquant : une opération ne peut pas être validée ou rejetée par son initiateur.' using errcode = 'P0001';
      end if;
      new.validateur_id := u;
      new.valide_le := now();
      if new.statut = 'valide' then
        perform controler_obligatoires_operation(new);
        perform controler_verrou(new.date_effet, 'une opération');
      elsif coalesce(trim(new.motif_rejet), '') = '' then
        raise exception 'Le motif du rejet est obligatoire.' using errcode = 'P0001';
      end if;
    elsif new.statut = 'regle' then
      if not (a_role('back_office') or a_role('validateur')) then
        raise exception 'Droits insuffisants : seul le back-office constate le règlement.' using errcode = 'P0001';
      end if;
      if new.date_reglement is null then
        raise exception 'La date de règlement est obligatoire.' using errcode = 'P0001';
      end if;
      new.regle_par := u;
      new.regle_le := now();
    elsif new.statut = 'annule' then
      if old.statut in ('valide','regle') then
        perform exiger_role('validateur', 'annuler une opération validée');
        if u = old.initiateur_id then
          raise exception 'Contrôle bloquant : une opération validée ne peut pas être annulée par son initiateur.' using errcode = 'P0001';
        end if;
        perform controler_verrou(old.date_effet, 'l''annulation d''une opération');
      elsif u is distinct from old.initiateur_id and not a_role('validateur') then
        raise exception 'Seul l''initiateur ou un validateur peut abandonner cette opération.' using errcode = 'P0001';
      end if;
      if coalesce(trim(new.motif_annulation), '') = '' then
        raise exception 'Le motif de l''annulation est obligatoire.' using errcode = 'P0001';
      end if;
      new.annule_par := u;
      new.annule_le := now();
    elsif new.statut = 'brouillon' and u is distinct from old.initiateur_id then
      raise exception 'Seul l''initiateur peut reprendre son opération en brouillon.' using errcode = 'P0001';
    end if;
  end if;
  new.version := old.version + 1;
  return new;
end $$;

drop trigger if exists t_operations_regles on operations;
create trigger t_operations_regles before insert or update on operations
  for each row execute function regles_operation();

create or replace function apres_operation() returns trigger
language plpgsql as $$
begin
  if (tg_op = 'INSERT' and new.statut in ('valide','regle'))
     or (tg_op = 'UPDATE' and (old.statut in ('valide','regle')) is distinct from (new.statut in ('valide','regle'))) then
    perform recalculer_position(new.position_id);
    if new.position_destination_id is not null then perform recalculer_position(new.position_destination_id); end if;
  end if;
  return null;
end $$;

drop trigger if exists t_operations_apres on operations;
create trigger t_operations_apres after insert or update on operations
  for each row execute function apres_operation();

create or replace function interdire_suppression_operation() returns trigger
language plpgsql as $$
begin
  if old.statut <> 'brouillon' then
    raise exception 'Une opération soumise, validée ou annulée est conservée : elle ne peut pas être supprimée.' using errcode = 'P0001';
  end if;
  return old;
end $$;

drop trigger if exists t_operations_suppression on operations;
create trigger t_operations_suppression before delete on operations
  for each row execute function interdire_suppression_operation();

-- -----------------------------------------------------------------------------
-- 4. Grevages : contrôle du disponible avant validation et à chaque augmentation
-- -----------------------------------------------------------------------------
create or replace function controler_disponible(g grevages) returns void
language plpgsql as $$
declare detenu numeric; autres numeric;
begin
  select nominal_actuel into detenu from positions where id = g.position_id for update;
  autres := nominal_greve_actif(g.position_id, g.id);
  if g.nominal_affecte + autres > detenu + 0.005 then
    raise exception 'Contrôle bloquant : grevage supérieur au nominal disponible (demandé %, disponible %).',
      to_char(g.nominal_affecte, 'FM999G999G999G990D00'), to_char(detenu - autres, 'FM999G999G999G990D00')
      using errcode = 'P0001';
  end if;
end $$;

create or replace function regles_grevage() returns trigger
language plpgsql as $$
declare u uuid := utilisateur_courant();
begin
  if tg_op = 'INSERT' then
    if new.statut not in ('brouillon','soumis') then
      raise exception 'Un grevage est créé en brouillon ou soumis, puis validé par un validateur.' using errcode = 'P0001';
    end if;
    new.initiateur_id := coalesce(new.initiateur_id, exiger_utilisateur());
    return new;
  end if;

  if old.statut in ('leve','rejete') and new.statut = old.statut then
    raise exception 'Un grevage levé ou rejeté ne se modifie plus.' using errcode = 'P0001';
  end if;
  if old.statut in ('soumis','actif') and (new.position_id, new.beneficiaire_id, new.date_debut, new.initiateur_id)
       is distinct from (old.position_id, old.beneficiaire_id, old.date_debut, old.initiateur_id) then
    raise exception 'Position, bénéficiaire et date de début d''un grevage soumis ou actif ne se modifient pas.' using errcode = 'P0001';
  end if;

  if new.statut is distinct from old.statut then
    if not ((old.statut, new.statut) in (('brouillon','soumis'), ('soumis','brouillon'), ('soumis','actif'),
            ('soumis','rejete'), ('actif','leve'), ('rejete','brouillon'))) then
      raise exception 'Passage du grevage de « % » à « % » non autorisé.', old.statut, new.statut using errcode = 'P0001';
    end if;
    if new.statut in ('actif','rejete') then
      perform exiger_role('validateur', 'approuver ou rejeter un grevage');
      if u = old.initiateur_id then
        raise exception 'Contrôle bloquant : un grevage ne peut pas être validé par son initiateur.' using errcode = 'P0001';
      end if;
      new.validateur_id := u;
      new.valide_le := now();
      if new.statut = 'actif' then perform controler_disponible(new);
      elsif coalesce(trim(new.motif_rejet), '') = '' then
        raise exception 'Le motif du rejet est obligatoire.' using errcode = 'P0001';
      end if;
    elsif new.statut = 'leve' then
      if not (a_role('back_office') or a_role('validateur')) then
        raise exception 'Droits insuffisants : la mainlevée est faite par le back-office ou un validateur.' using errcode = 'P0001';
      end if;
      if coalesce(trim(new.motif_levee), '') = '' then
        raise exception 'Le motif de la mainlevée est obligatoire.' using errcode = 'P0001';
      end if;
      new.leve_par := u;
      new.leve_le := now();
      new.date_fin := coalesce(new.date_fin, current_date);
    end if;
  elsif old.statut = 'actif' and new.nominal_affecte > old.nominal_affecte then
    -- Augmentation d'un grevage actif : même contrôle du disponible, par un validateur.
    perform exiger_role('validateur', 'augmenter un grevage actif');
    perform controler_disponible(new);
  elsif old.statut = 'actif' and new.nominal_affecte < old.nominal_affecte then
    if not (a_role('back_office') or a_role('validateur')) then
      raise exception 'Droits insuffisants pour réduire un grevage.' using errcode = 'P0001';
    end if;
  end if;
  new.version := old.version + 1;
  return new;
end $$;

drop trigger if exists t_grevages_regles on grevages;
create trigger t_grevages_regles before insert or update on grevages
  for each row execute function regles_grevage();

create or replace function interdire_suppression_grevage() returns trigger
language plpgsql as $$
begin
  if old.statut <> 'brouillon' then
    raise exception 'Un grevage soumis, actif, levé ou rejeté est conservé : il ne peut pas être supprimé.' using errcode = 'P0001';
  end if;
  return old;
end $$;

drop trigger if exists t_grevages_suppression on grevages;
create trigger t_grevages_suppression before delete on grevages
  for each row execute function interdire_suppression_grevage();

-- -----------------------------------------------------------------------------
-- 5. Encaissements : cohérence et arrêtés verrouillés
-- -----------------------------------------------------------------------------
create or replace function regles_encaissement() returns trigger
language plpgsql as $$
declare pos uuid;
begin
  if tg_op = 'INSERT' then
    perform exiger_utilisateur();
    new.saisi_par := coalesce(new.saisi_par, utilisateur_courant());
    perform controler_verrou(new.date_valeur, 'un encaissement');
    if new.echeance_id is not null then
      select position_id into pos from echeances where id = new.echeance_id;
      if pos is distinct from new.position_id then
        raise exception 'L''échéance rapprochée n''appartient pas à cette position.' using errcode = 'P0001';
      end if;
    end if;
    return new;
  end if;
  if (new.position_id, new.date_valeur, new.montant, new.montant_capital, new.montant_interet)
     is distinct from (old.position_id, old.date_valeur, old.montant, old.montant_capital, old.montant_interet) then
    raise exception 'Un encaissement enregistré ne se modifie pas : annulez-le et saisissez-le à nouveau.' using errcode = 'P0001';
  end if;
  if new.echeance_id is distinct from old.echeance_id then
    if new.echeance_id is not null then
      select position_id into pos from echeances where id = new.echeance_id;
      if pos is distinct from new.position_id then
        raise exception 'L''échéance rapprochée n''appartient pas à cette position.' using errcode = 'P0001';
      end if;
    end if;
  end if;
  if new.statut = 'annule' and old.statut = 'actif' then
    perform controler_verrou(old.date_valeur, 'l''annulation d''un encaissement');
    if coalesce(trim(new.motif_annulation), '') = '' then
      raise exception 'Le motif de l''annulation est obligatoire.' using errcode = 'P0001';
    end if;
  elsif new.statut = 'actif' and old.statut = 'annule' then
    raise exception 'Un encaissement annulé ne peut pas être réactivé.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists t_encaissements_regles on encaissements;
create trigger t_encaissements_regles before insert or update on encaissements
  for each row execute function regles_encaissement();

-- -----------------------------------------------------------------------------
-- 6. Arrêtés : verrouillage et procédure de réouverture
-- -----------------------------------------------------------------------------
create or replace function regles_arrete() returns trigger
language plpgsql as $$
declare u uuid := utilisateur_courant();
begin
  if tg_op = 'DELETE' then
    if old.verrouille_le is not null then
      raise exception 'Un arrêté qui a été verrouillé est conservé : il ne peut pas être supprimé.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.cree_par := coalesce(new.cree_par, exiger_utilisateur());
    if new.statut <> 'ouvert' then
      raise exception 'Un arrêté est créé ouvert, puis verrouillé.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.statut = 'verrouille' then
    if new.statut <> 'rouvert' or new.resultat is distinct from old.resultat or new.date_arrete <> old.date_arrete then
      raise exception 'Arrêté verrouillé : aucune modification sans procédure de réouverture.' using errcode = 'P0001';
    end if;
    perform exiger_role('validateur', 'rouvrir un arrêté verrouillé');
    if coalesce(trim(new.motif_reouverture), '') = '' then
      raise exception 'Le motif de la réouverture est obligatoire.' using errcode = 'P0001';
    end if;
    new.rouvert_par := u;
    new.rouvert_le := now();
    return new;
  end if;
  if new.date_arrete <> old.date_arrete then
    raise exception 'La date d''un arrêté ne se modifie pas.' using errcode = 'P0001';
  end if;
  if new.statut = 'verrouille' then
    if not (a_role('validateur') or a_role('comptabilite')) then
      raise exception 'Droits insuffisants : le verrouillage est fait par la comptabilité ou un validateur.' using errcode = 'P0001';
    end if;
    new.verrouille_par := u;
    new.verrouille_le := now();
  end if;
  return new;
end $$;

drop trigger if exists t_arretes_regles on arretes;
create trigger t_arretes_regles before insert or update or delete on arretes
  for each row execute function regles_arrete();

-- -----------------------------------------------------------------------------
-- 7. Instruments : modification sensible → nouvelle validation (≠ auteur)
-- -----------------------------------------------------------------------------
create or replace function regles_instrument() returns trigger
language plpgsql as $$
declare u uuid := utilisateur_courant();
begin
  if tg_op = 'INSERT' then
    new.cree_par := coalesce(new.cree_par, u);
    new.modifie_par := coalesce(new.modifie_par, u);
    if new.statut = 'valide' then new.statut := 'a_valider'; end if;
    new.precompte := new.precompte or coalesce((select precompte from types_instrument where code = new.type_code), false);
    return new;
  end if;

  if (new.code_interne, new.isin, new.nominal_unitaire, new.date_emission, new.date_echeance, new.taux_coupon,
      new.convention, new.frequence, new.profil, new.differe_mois, new.precompte, new.taux_retenue, new.devise_code)
     is distinct from
     (old.code_interne, old.isin, old.nominal_unitaire, old.date_emission, old.date_echeance, old.taux_coupon,
      old.convention, old.frequence, old.profil, old.differe_mois, old.precompte, old.taux_retenue, old.devise_code)
     or (new.libelle, new.emetteur_id, new.pays_code, new.zone, new.type_code, new.conditions_remboursement)
     is distinct from (old.libelle, old.emetteur_id, old.pays_code, old.zone, old.type_code, old.conditions_remboursement)
  then
    new.modifie_par := u;
    new.modifie_le := now();
    new.version := old.version + 1;
    -- Toute modification d'une caractéristique remet l'instrument en attente de validation.
    if new.statut is not distinct from old.statut then
      new.statut := 'a_valider';
      new.valide_par := null;
      new.valide_le := null;
    end if;
  end if;

  if new.statut is distinct from old.statut and new.statut in ('valide','rejete') then
    perform exiger_role('validateur', 'valider les caractéristiques d''un instrument');
    if u = coalesce(new.modifie_par, new.cree_par) then
      raise exception 'Contrôle bloquant : les caractéristiques doivent être validées par une autre personne que leur auteur.'
        using errcode = 'P0001';
    end if;
    if new.statut = 'valide' and (new.date_echeance is null or new.nominal_unitaire is null
        or (not new.precompte and new.frequence > 0 and new.date_emission is null)) then
      raise exception 'Instrument incomplet : date d''émission, date d''échéance et nominal unitaire sont obligatoires pour le valider.'
        using errcode = 'P0001';
    end if;
    if new.statut = 'rejete' and coalesce(trim(new.motif_rejet), '') = '' then
      raise exception 'Le motif du rejet est obligatoire.' using errcode = 'P0001';
    end if;
    new.valide_par := u;
    new.valide_le := now();
  end if;

  if new.echeancier_officiel_valide and not old.echeancier_officiel_valide then
    perform exiger_role('validateur', 'valider un échéancier officiel');
    if exists (select 1 from echeancier_officiel where instrument_id = new.id and importe_par = u) then
      raise exception 'Contrôle bloquant : l''échéancier officiel doit être validé par une autre personne que celle qui l''a importé.'
        using errcode = 'P0001';
    end if;
    if abs(coalesce((select sum(part_capital) from echeancier_officiel where instrument_id = new.id), 0) - 1) > 0.000001 then
      raise exception 'Échéancier officiel incohérent : la somme des parts de capital doit être égale à 100 %%.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists t_instruments_regles on instruments;
create trigger t_instruments_regles before insert or update on instruments
  for each row execute function regles_instrument();

-- Toute modification de l'échéancier officiel retire sa validation.
create or replace function invalider_echeancier_officiel() returns trigger
language plpgsql as $$
begin
  update instruments set echeancier_officiel_valide = false
  where id = coalesce(new.instrument_id, old.instrument_id) and echeancier_officiel_valide;
  return null;
end $$;

drop trigger if exists t_echeancier_officiel_invalider on echeancier_officiel;
create trigger t_echeancier_officiel_invalider after insert or update or delete on echeancier_officiel
  for each row execute function invalider_echeancier_officiel();

-- -----------------------------------------------------------------------------
-- 8. Comptes : toujours au moins un administrateur actif
-- -----------------------------------------------------------------------------
create or replace function garder_un_admin() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from utilisateurs where actif and 'admin' = any(roles)) and exists (select 1 from utilisateurs) then
    raise exception 'Il doit rester au moins un administrateur actif.' using errcode = 'P0001';
  end if;
  return null;
end $$;

drop trigger if exists t_utilisateurs_admin on utilisateurs;
create trigger t_utilisateurs_admin after update or delete on utilisateurs
  for each statement execute function garder_un_admin();

-- -----------------------------------------------------------------------------
-- 9. Journal, audit, mouvements de grevage : ajout seul (jamais modifiés ni effacés)
-- -----------------------------------------------------------------------------
create or replace function interdire_modification() returns trigger
language plpgsql as $$
begin
  raise exception 'La table % est en ajout seul : ses lignes ne peuvent être ni modifiées ni supprimées.', tg_table_name
    using errcode = 'P0001';
end $$;

drop trigger if exists t_journal_ajout_seul on journal;
create trigger t_journal_ajout_seul before update or delete on journal
  for each row execute function interdire_modification();
drop trigger if exists t_audit_ajout_seul on audit;
create trigger t_audit_ajout_seul before update or delete on audit
  for each row execute function interdire_modification();
-- Mouvements de grevage : jamais modifiés ; supprimés seulement avec leur grevage resté en brouillon
-- (jamais validé, par exemple lors de l'annulation d'un import).
create or replace function proteger_mouvement_grevage() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from grevages where id = old.grevage_id) then
    return old;  -- suppression en cascade du grevage brouillon
  end if;
  raise exception 'Les mouvements de grevage sont en ajout seul : ils ne peuvent être ni modifiés ni supprimés.' using errcode = 'P0001';
end $$;

drop trigger if exists t_mouvements_ajout_seul on mouvements_grevage;
create trigger t_mouvements_ajout_seul before update or delete on mouvements_grevage
  for each row execute function proteger_mouvement_grevage();
-- Protège aussi contre un « truncate » accidentel.
drop trigger if exists t_journal_truncate on journal;
create trigger t_journal_truncate before truncate on journal
  for each statement execute function interdire_modification();
drop trigger if exists t_audit_truncate on audit;
create trigger t_audit_truncate before truncate on audit
  for each statement execute function interdire_modification();

-- -----------------------------------------------------------------------------
-- 10. Audit automatique : auteur, date, ancienne et nouvelle valeur
-- -----------------------------------------------------------------------------
create or replace function auditer() returns trigger
language plpgsql as $$
declare
  ancien jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - 'mot_de_passe_hash' - 'contenu' - 'resultat' - 'lignes' end;
  nouveau jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - 'mot_de_passe_hash' - 'contenu' - 'resultat' - 'lignes' end;
  ligne jsonb := coalesce(nouveau, ancien);
begin
  if tg_op = 'UPDATE' and ancien = nouveau then return null; end if;
  insert into audit (utilisateur_id, table_nom, ligne_id, operation, ancien, nouveau)
  values (utilisateur_courant(), tg_table_name,
          coalesce(ligne->>'id', ligne->>'cle', ligne->>'code', concat_ws(':', ligne->>'utilisateur_id', ligne->>'portefeuille_id')),
          tg_op, ancien, nouveau);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['utilisateurs','utilisateurs_portefeuilles','pays','devises','types_instrument','emetteurs',
    'conservateurs','contreparties','entites','portefeuilles','tranches_maturite','jours_feries','parametres',
    'instruments','echeancier_officiel','classifications','positions','operations','pieces','encaissements',
    'grevages','arretes','imports','quarantaine','suivi_controles']
  loop
    execute format('drop trigger if exists t_audit on %I', t);
    execute format('create trigger t_audit after insert or update or delete on %I for each row execute function auditer()', t);
  end loop;
end $$;

-- Les échéances sont recalculées par le moteur : on n'audite que les décisions humaines (litige, explication).
drop trigger if exists t_audit on echeances;
create trigger t_audit after update on echeances for each row
  when (old.statut_manuel is distinct from new.statut_manuel or old.explication_ecart is distinct from new.explication_ecart
        or old.motif_statut is distinct from new.motif_statut)
  execute function auditer();

-- Les positions changent à chaque opération validée : on n'audite pas le recalcul automatique.
drop trigger if exists t_audit on positions;
create trigger t_audit after insert or delete or update of portefeuille_id, instrument_id, conservateur_id,
  compte_conservation, statut, nominal_releve, date_releve on positions
  for each row execute function auditer();

select 'Règles Titrix installées.' as resultat;
