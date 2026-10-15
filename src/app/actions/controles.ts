"use server";
/**
 * Suivi des alertes et anomalies : responsable, statut de traitement, commentaire.
 */
import { revalidatePath } from "next/cache";
import { transaction } from "@/lib/db";
import { ErreurMetier, exigerPermission } from "@/lib/session";
import { lireTexte } from "@/lib/format";
import { journaliser } from "@/donnees/journal";
import { erreur, ok, type Retour } from "./commun";

export async function suivreControle(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("traiter_controles");
    const cle = lireTexte(f.get("cle"));
    const statut = lireTexte(f.get("statut"));
    if (!["nouveau", "en_cours", "traite", "accepte"].includes(statut)) throw new ErreurMetier("Statut inconnu.");
    const commentaire = lireTexte(f.get("commentaire"));
    if (statut === "accepte" && !commentaire) throw new ErreurMetier("Expliquez pourquoi le point est accepté (commentaire obligatoire).");
    await transaction(s.u.id, async (c) => {
      await c.query(
        `insert into suivi_controles (cle, statut, responsable_id, commentaire, modifie_par, modifie_le) values ($1,$2,$3,$4,$5,now())
         on conflict (cle) do update set statut = excluded.statut, responsable_id = excluded.responsable_id,
           commentaire = excluded.commentaire, modifie_par = excluded.modifie_par, modifie_le = now()`,
        [cle, statut, lireTexte(f.get("responsable_id")) || null, commentaire, s.u.id],
      );
      await journaliser(c, s, "Alerte / anomalie suivie", "controle", cle, { statut, commentaire });
    });
    revalidatePath("/controles");
    return ok("Suivi enregistré.");
  } catch (e) {
    return erreur(e);
  }
}

export async function traiterQuarantaine(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("traiter_controles");
    const id = lireTexte(f.get("id"));
    const statut = lireTexte(f.get("statut"));
    const commentaire = lireTexte(f.get("motif")) || lireTexte(f.get("commentaire"));
    if (!["corrigee", "rejetee", "ouverte"].includes(statut)) throw new ErreurMetier("Statut inconnu.");
    if (statut !== "ouverte" && !commentaire) throw new ErreurMetier("Le commentaire est obligatoire.");
    await transaction(s.u.id, async (c) => {
      await c.query("update quarantaine set statut = $2, commentaire = $3, traite_par = $4, traite_le = now() where id = $1", [id, statut, commentaire, s.u.id]);
      await journaliser(c, s, `Ligne en quarantaine ${statut === "corrigee" ? "corrigée" : statut === "rejetee" ? "rejetée" : "rouverte"}`, "quarantaine", id, { commentaire });
    });
    revalidatePath("/controles");
    return ok("Ligne mise à jour (le journal d'import est conservé).");
  } catch (e) {
    return erreur(e);
  }
}
