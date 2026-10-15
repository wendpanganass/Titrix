/**
 * Échéances enregistrées : produites par le moteur, conservées en base pour le suivi des encaissements.
 * Elles sont recalculées après chaque opération validée, modification d'instrument ou échéancier officiel.
 * Une échéance déjà encaissée n'est jamais effacée : si elle disparaît du calcul, elle passe « remplacée ».
 */
import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { echeancesPosition, type OperationCalc, type TypeOperation } from "@/moteur";
import { SQL_INSTRUMENTS, versInstrumentDonnees } from "./portefeuille";

export async function regenererEcheances(c: PoolClient, positionId: string) {
  const pos = await c.query<{ instrument_id: string }>("select instrument_id from positions where id = $1", [positionId]);
  if (!pos.rows[0]) return { ecrites: 0, retirees: 0 };
  const instrumentId = pos.rows[0].instrument_id;
  // Requêtes l'une après l'autre : un client de transaction ne traite qu'une requête à la fois.
  const inst = await c.query(`${SQL_INSTRUMENTS} where i.id = $1`, [instrumentId]);
  const officiel = await c.query<{ date_echeance: string; part_capital: number }>(
    "select date_echeance, part_capital from echeancier_officiel where instrument_id = $1 order by date_echeance",
    [instrumentId],
  );
  const ops = await c.query<{
      id: string;
      type: TypeOperation;
      statut: string;
      date_effet: string;
      nominal: number;
      quantite: number | null;
      position_id: string;
      position_destination_id: string | null;
    }>(
      `select id, type, statut, date_effet, nominal, quantite, position_id, position_destination_id from operations
        where (position_id = $1 or position_destination_id = $1) and statut in ('valide','regle')`,
      [positionId],
    );
  const feries = await c.query<{ date: string }>("select date from jours_feries");
  const instrument = versInstrumentDonnees(
    inst.rows[0],
    officiel.rows.map((o) => ({ date: o.date_echeance, partCapital: o.part_capital })),
  );
  const operations: OperationCalc[] = ops.rows.map((o) => ({
    id: o.id,
    type: o.type,
    statut: o.statut,
    dateEffet: o.date_effet,
    nominal: o.nominal,
    quantite: o.quantite,
    positionId: o.position_id,
    positionDestinationId: o.position_destination_id,
  }));
  const res = echeancesPosition(instrument, operations, positionId, { officiel: instrument.officiel, feries: new Set(feries.rows.map((f) => f.date)) });
  const empreinte = createHash("sha256")
    .update(
      JSON.stringify([
        instrument.dateEmission,
        instrument.dateEcheance,
        instrument.tauxCoupon,
        instrument.convention,
        instrument.frequence,
        instrument.profil,
        instrument.differeMois,
        instrument.precompte,
        instrument.tauxRetenue,
        instrument.officiel,
      ]),
    )
    .digest("hex")
    .slice(0, 16);

  for (const e of res.echeances) {
    await c.query(
      `insert into echeances (position_id, date_contractuelle, date_reglement_prevue, debut_periode, fin_periode, crd_debut,
                              capital_du, interet_brut, retenue, net_attendu, source, version_moteur, empreinte_parametres)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (position_id, date_contractuelle) do update set
         date_reglement_prevue = excluded.date_reglement_prevue, debut_periode = excluded.debut_periode,
         fin_periode = excluded.fin_periode, crd_debut = excluded.crd_debut, capital_du = excluded.capital_du,
         interet_brut = excluded.interet_brut, retenue = excluded.retenue, net_attendu = excluded.net_attendu,
         source = excluded.source, version_moteur = excluded.version_moteur,
         empreinte_parametres = excluded.empreinte_parametres, genere_le = now(),
         statut_manuel = case when echeances.statut_manuel = 'remplacee' then null else echeances.statut_manuel end`,
      [
        positionId,
        e.dateContractuelle,
        e.dateReglementPrevue,
        e.debutPeriode,
        e.finPeriode,
        e.crdDebut,
        e.capitalDu,
        e.interetBrut,
        e.retenue,
        e.netAttendu,
        e.source,
        e.versionMoteur,
        empreinte,
      ],
    );
  }
  const dates = res.echeances.map((e) => e.dateContractuelle);
  // Échéances qui ne sont plus dues : supprimées si rien n'y est rattaché, sinon « remplacées ».
  const retirees = await c.query(
    `delete from echeances e where e.position_id = $1 and not (e.date_contractuelle = any($2::date[]))
       and not exists (select 1 from encaissements x where x.echeance_id = e.id)
       and not exists (select 1 from operations o where o.echeance_id = e.id)`,
    [positionId, dates],
  );
  await c.query(
    `update echeances set statut_manuel = 'remplacee', motif_statut = 'Échéance retirée par le recalcul (opérations ou caractéristiques modifiées)'
      where position_id = $1 and not (date_contractuelle = any($2::date[])) and statut_manuel is distinct from 'remplacee'`,
    [positionId, dates],
  );
  return { ecrites: res.echeances.length, retirees: retirees.rowCount ?? 0, erreurs: res.erreurs };
}

/** Recalcule les échéances de toutes les positions d'un instrument. */
export async function regenererInstrument(c: PoolClient, instrumentId: string) {
  const p = await c.query<{ id: string }>("select id from positions where instrument_id = $1", [instrumentId]);
  for (const r of p.rows) await regenererEcheances(c, r.id);
  return p.rows.length;
}
