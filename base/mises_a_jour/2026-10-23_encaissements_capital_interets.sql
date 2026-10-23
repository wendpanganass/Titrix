-- =============================================================================
-- TITRIX — Mise à jour du 23/10/2026 : encaissements ventilés entre capital et intérêts
-- =============================================================================
-- À exécuter UNE fois dans Neon → SQL Editor → nouvelle requête (bouton ⊕) → coller → Run.
-- Rejouable sans risque ; n'efface aucune donnée. Les encaissements déjà saisis sont ventilés
-- automatiquement (intérêts d'abord, dans la limite des intérêts nets de l'échéance, puis capital).
-- =============================================================================

-- Ventilation de chaque encaissement entre capital et intérêts (montant = capital + intérêts).
alter table encaissements add column if not exists montant_capital numeric(24,2) not null default 0;
alter table encaissements add column if not exists montant_interet numeric(24,2) not null default 0;
-- Reprise des encaissements déjà saisis : les intérêts sont réputés payés en premier
-- (dans la limite des intérêts nets de l'échéance), le solde est du capital.
update encaissements x set
  montant_interet = r.interet,
  montant_capital = x.montant - r.interet
from (
  select x2.id,
         case when x2.nature = 'capital' then 0
              when x2.nature = 'interet' then x2.montant
              else least(x2.montant, coalesce((select greatest(e.interet_brut - e.retenue, 0) from echeances e where e.id = x2.echeance_id), x2.montant))
         end as interet
    from encaissements x2
) r
where r.id = x.id and x.montant_capital + x.montant_interet <> x.montant;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'encaissements_ventilation') then
    alter table encaissements add constraint encaissements_ventilation
      check (montant_capital >= 0 and montant_interet >= 0 and montant = montant_capital + montant_interet);
  end if;
end $$;

-- Règle : la ventilation d'un encaissement enregistré ne se modifie pas (annuler puis ressaisir).
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


select count(*) as encaissements,
       coalesce(sum(montant_capital), 0) as capital_recu,
       coalesce(sum(montant_interet), 0) as interets_recus,
       count(*) filter (where montant <> montant_capital + montant_interet) as anomalies
  from encaissements;
