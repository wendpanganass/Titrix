"use server";
/**
 * Positions : détention d'un instrument dans un portefeuille, chez un conservateur.
 * Le nominal n'est jamais saisi directement : il résulte des opérations validées.
 */
import { revalidatePath } from "next/cache";
import { transaction } from "@/lib/db";
import { ErreurMetier, exigerPermission } from "@/lib/session";
import { lireDate, lireNombre, lireTexte } from "@/lib/format";
import { journaliser } from "@/donnees/journal";
import { regenererEcheances } from "@/donnees/echeances";
import { erreur, ok, type Retour } from "./commun";

export async function creerPosition(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("saisir_operation");
    const portefeuille = lireTexte(f.get("portefeuille_id"));
    const instrument = lireTexte(f.get("instrument_id"));
    const conservateur = lireTexte(f.get("conservateur_id"));
    if (!portefeuille || !instrument || !conservateur) throw new ErreurMetier("Portefeuille, instrument et conservateur sont obligatoires.");
    if (s.u.portefeuilles.length && !s.u.portefeuilles.includes(portefeuille)) throw new ErreurMetier("Ce portefeuille ne fait pas partie de votre périmètre.");
    const id = await transaction(s.u.id, async (c) => {
      const r = await c.query<{ id: string }>(
        `insert into positions (portefeuille_id, instrument_id, conservateur_id, compte_conservation, identifiant_position, cree_par)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [portefeuille, instrument, conservateur, lireTexte(f.get("compte_conservation")), lireTexte(f.get("identifiant_position")), s.u.id],
      );
      await journaliser(c, s, "Position créée", "position", r.rows[0].id);
      return r.rows[0].id;
    });
    revalidatePath("/positions");
    return ok("Position créée. Saisissez maintenant son opération d'acquisition ou sa position d'ouverture.", { id });
  } catch (e) {
    return erreur(e);
  }
}

export async function enregistrerReleve(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("rapprocher");
    const id = lireTexte(f.get("id"));
    const nominal = lireNombre(f.get("nominal_releve"));
    const date = lireDate(f.get("date_releve"));
    if (nominal !== null && !date) throw new ErreurMetier("Indiquez la date du relevé.");
    await transaction(s.u.id, async (c) => {
      await c.query("update positions set nominal_releve = $2, date_releve = $3 where id = $1", [id, nominal, nominal === null ? null : date]);
      await journaliser(c, s, "Relevé du conservateur saisi", "position", id, { nominal, date });
    });
    revalidatePath(`/positions/${id}`);
    return ok("Relevé enregistré : l'écart éventuel apparaît dans le rapprochement et les alertes.");
  } catch (e) {
    return erreur(e);
  }
}

export async function bloquerPosition(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("valider");
    const id = lireTexte(f.get("id"));
    const bloquer = lireTexte(f.get("bloquer")) === "1";
    const motif = lireTexte(f.get("motif"));
    await transaction(s.u.id, async (c) => {
      await c.query(
        "update positions set statut = case when $2 then 'bloquee' when nominal_actuel = 0 then 'soldee' else 'active' end where id = $1",
        [id, bloquer],
      );
      await journaliser(c, s, bloquer ? "Position bloquée" : "Position débloquée", "position", id, { motif });
    });
    revalidatePath(`/positions/${id}`);
    return ok(bloquer ? "Position bloquée." : "Position débloquée.");
  } catch (e) {
    return erreur(e);
  }
}

export async function recalculerPosition(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("saisir_operation");
    const id = lireTexte(f.get("id"));
    const r = await transaction(s.u.id, async (c) => {
      await c.query("select recalculer_position($1)", [id]);
      return regenererEcheances(c, id);
    });
    revalidatePath(`/positions/${id}`);
    return ok(`Échéancier recalculé : ${r.ecrites} échéance(s).`);
  } catch (e) {
    return erreur(e);
  }
}
