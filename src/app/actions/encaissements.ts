"use server";
/**
 * Encaissements et rapprochement (§6.4) : flux réellement reçus, rapprochés d'une échéance.
 * Chaque encaissement est ventilé entre CAPITAL et INTÉRÊTS (nets de retenue) : le capital reçu
 * suit l'encours, les intérêts reçus suivent les produits. Le capital reçu propose l'opération
 * d'amortissement / remboursement correspondante (soumise à validation) : l'arrivée à échéance
 * ne suffit jamais à considérer un titre remboursé.
 */
import { revalidatePath } from "next/cache";
import { transaction } from "@/lib/db";
import { ErreurMetier, exigerPermission } from "@/lib/session";
import { lireDate, lireNombre, lireTexte } from "@/lib/format";
import { journaliser } from "@/donnees/journal";
import { erreur, ok, type Retour } from "./commun";

const fr = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const arrondi2 = (n: number) => Math.round(n * 100) / 100;

export async function enregistrerEncaissement(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("encaisser");
    const echeanceId = lireTexte(f.get("echeance_id"));
    const capital = arrondi2(lireNombre(f.get("montant_capital")) ?? 0);
    const interet = arrondi2(lireNombre(f.get("montant_interet")) ?? 0);
    const date = lireDate(f.get("date_valeur"));
    if (capital < 0 || interet < 0) throw new ErreurMetier("Le capital et les intérêts reçus ne peuvent pas être négatifs.");
    const montant = arrondi2(capital + interet);
    if (montant <= 0) throw new ErreurMetier("Saisissez le capital reçu et/ou les intérêts reçus.");
    if (!date) throw new ErreurMetier("La date de valeur est obligatoire.");
    const nature = capital > 0 && interet > 0 ? "mixte" : capital > 0 ? "capital" : "interet";
    const constaterCapital = lireTexte(f.get("constater_capital")) === "1";
    const message = await transaction(s.u.id, async (c) => {
      const e = await c.query<{
        position_id: string; capital_du: number; interet_net: number; date_contractuelle: string; date_echeance: string | null;
        capital_recu: number; interet_recu: number; capital_constate: number;
      }>(
        `select e.position_id, e.capital_du, greatest(e.interet_brut - e.retenue, 0) as interet_net, e.date_contractuelle, i.date_echeance,
                (select coalesce(sum(montant_capital), 0) from encaissements x where x.echeance_id = e.id and x.statut = 'actif') as capital_recu,
                (select coalesce(sum(montant_interet), 0) from encaissements x where x.echeance_id = e.id and x.statut = 'actif') as interet_recu,
                (select coalesce(sum(o.nominal), 0) from operations o where o.echeance_id = e.id and o.statut not in ('rejete','annule')) as capital_constate
           from echeances e join positions p on p.id = e.position_id join instruments i on i.id = p.instrument_id where e.id = $1`,
        [echeanceId],
      );
      if (!e.rows[0]) throw new ErreurMetier("Échéance introuvable.");
      const ech = e.rows[0];
      const resteCapital = arrondi2(ech.capital_du - ech.capital_recu);
      if (capital > resteCapital + 0.01)
        throw new ErreurMetier(
          `Le capital reçu (${fr(capital)}) dépasse le capital restant dû sur cette échéance (${fr(Math.max(0, resteCapital))}). ` +
            "Un remboursement anticipé se saisit comme opération ; un excédent d'intérêts se saisit en intérêts.",
        );
      await c.query(
        `insert into encaissements (position_id, echeance_id, date_valeur, montant, montant_capital, montant_interet, nature, reference, commentaire)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [ech.position_id, echeanceId, date, montant, capital, interet, nature, lireTexte(f.get("reference")), lireTexte(f.get("commentaire"))],
      );
      const suite: string[] = [];
      const tropPercu = arrondi2(ech.interet_recu + interet - ech.interet_net);
      if (tropPercu > 0.01) suite.push(`Attention : ${fr(tropPercu)} d'intérêts reçus au-delà des intérêts nets attendus (écart à expliquer).`);
      // Capital reçu non encore constaté par une opération : on propose l'amortissement correspondant.
      const aConstater = arrondi2(ech.capital_recu + capital - ech.capital_constate);
      if (constaterCapital && capital > 0) {
        if (aConstater <= 0.01) suite.push("Le capital reçu est déjà constaté par une opération d'amortissement.");
        else {
          const type = ech.date_contractuelle === ech.date_echeance && aConstater >= ech.capital_du - 0.01 ? "remboursement" : "amortissement";
          const r = await c.query<{ numero: number }>(
            `insert into operations (type, position_id, date_effet, nominal, echeance_id, reference, commentaire, statut)
             values ($1,$2,$3,$4,$5,$6,'Proposée à l''enregistrement de l''encaissement (capital reçu)','soumis') returning numero`,
            [type, ech.position_id, ech.date_contractuelle, aConstater, echeanceId, lireTexte(f.get("reference"))],
          );
          suite.push(`Opération n° ${r.rows[0].numero} (${type} de ${fr(aConstater)}) soumise à validation pour constater le capital remboursé.`);
        }
      }
      await journaliser(c, s, "Encaissement enregistré", "echeance", echeanceId, { montant, capital, interet, date });
      return [`Encaissement de ${fr(montant)} enregistré (capital ${fr(capital)}, intérêts ${fr(interet)}).`, ...suite].join(" ");
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
