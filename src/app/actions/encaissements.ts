"use server";
/**
 * Encaissements et rapprochement (§6.4) : flux réellement reçus, rapprochés d'une échéance.
 * Un encaissement de capital propose l'opération d'amortissement / remboursement correspondante
 * (soumise à validation) : l'arrivée à échéance ne suffit jamais à considérer un titre remboursé.
 */
import { revalidatePath } from "next/cache";
import { transaction } from "@/lib/db";
import { ErreurMetier, exigerPermission } from "@/lib/session";
import { lireDate, lireNombre, lireTexte } from "@/lib/format";
import { journaliser } from "@/donnees/journal";
import { erreur, ok, type Retour } from "./commun";

export async function enregistrerEncaissement(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("encaisser");
    const echeanceId = lireTexte(f.get("echeance_id"));
    const montant = lireNombre(f.get("montant"));
    const date = lireDate(f.get("date_valeur"));
    if (!montant || montant <= 0) throw new ErreurMetier("Le montant reçu doit être positif.");
    if (!date) throw new ErreurMetier("La date de valeur est obligatoire.");
    const constaterCapital = lireTexte(f.get("constater_capital")) === "1";
    const message = await transaction(s.u.id, async (c) => {
      const e = await c.query<{ position_id: string; capital_du: number; date_contractuelle: string; date_echeance: string | null; numero: number | null }>(
        `select e.position_id, e.capital_du, e.date_contractuelle, i.date_echeance,
                (select o.numero from operations o where o.echeance_id = e.id and o.statut not in ('rejete','annule') limit 1) as numero
           from echeances e join positions p on p.id = e.position_id join instruments i on i.id = p.instrument_id where e.id = $1`,
        [echeanceId],
      );
      if (!e.rows[0]) throw new ErreurMetier("Échéance introuvable.");
      const ech = e.rows[0];
      await c.query(
        `insert into encaissements (position_id, echeance_id, date_valeur, montant, nature, reference, commentaire)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [ech.position_id, echeanceId, date, montant, lireTexte(f.get("nature")) || "mixte", lireTexte(f.get("reference")), lireTexte(f.get("commentaire"))],
      );
      let suite = "";
      if (constaterCapital && ech.capital_du > 0) {
        if (ech.numero) suite = ` L'amortissement est déjà saisi (opération n° ${ech.numero}).`;
        else {
          const type = ech.date_contractuelle === ech.date_echeance ? "remboursement" : "amortissement";
          const r = await c.query<{ numero: number }>(
            `insert into operations (type, position_id, date_effet, nominal, echeance_id, reference, commentaire, statut)
             values ($1,$2,$3,$4,$5,$6,'Proposée à l''enregistrement de l''encaissement','soumis') returning numero`,
            [type, ech.position_id, ech.date_contractuelle, ech.capital_du, echeanceId, lireTexte(f.get("reference"))],
          );
          suite = ` Opération n° ${r.rows[0].numero} (${type}) soumise à validation pour constater le capital remboursé.`;
        }
      }
      await journaliser(c, s, "Encaissement enregistré", "echeance", echeanceId, { montant, date });
      return `Encaissement de ${montant.toLocaleString("fr-FR")} enregistré.${suite}`;
    });
    revalidatePath("/encaissements");
    revalidatePath("/", "layout");
    return ok(message);
  } catch (e) {
    return erreur(e);
  }
}

export async function annulerEncaissement(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("encaisser");
    const id = lireTexte(f.get("id"));
    const motif = lireTexte(f.get("motif"));
    await transaction(s.u.id, async (c) => {
      await c.query("update encaissements set statut = 'annule', motif_annulation = $2 where id = $1", [id, motif]);
      await journaliser(c, s, "Encaissement annulé", "encaissement", id, { motif });
    });
    revalidatePath("/encaissements");
    return ok("Encaissement annulé (il reste visible, barré).");
  } catch (e) {
    return erreur(e);
  }
}

/** Litige, annulation d'échéance, explication d'écart : décisions humaines tracées. */
export async function qualifierEcheance(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("encaisser");
    const id = lireTexte(f.get("id"));
    const statut = lireTexte(f.get("statut_manuel"));
    const motif = lireTexte(f.get("motif"));
    const explication = lireTexte(f.get("explication_ecart"));
    if (!["", "litige", "annulee"].includes(statut)) throw new ErreurMetier("Statut inconnu.");
    if (statut && !motif) throw new ErreurMetier("Le motif est obligatoire.");
    await transaction(s.u.id, async (c) => {
      await c.query(
        "update echeances set statut_manuel = nullif($2, ''), motif_statut = nullif($3, ''), explication_ecart = nullif($4, '') where id = $1",
        [id, statut, motif, explication],
      );
      await journaliser(c, s, statut ? `Échéance qualifiée : ${statut}` : "Échéance : explication / statut mis à jour", "echeance", id, { motif, explication });
    });
    revalidatePath("/encaissements");
    return ok("Échéance mise à jour.");
  } catch (e) {
    return erreur(e);
  }
}
