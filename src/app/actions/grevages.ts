"use server";
/**
 * Grevages (affectations en garantie) : création, validation avec contrôle du disponible,
 * augmentation, réduction, mainlevée. Chaque mouvement est historisé (mouvements_grevage).
 */
import { revalidatePath } from "next/cache";
import { transaction } from "@/lib/db";
import { ErreurMetier, exigerPermission, sessionCourante } from "@/lib/session";
import { lireDate, lireNombre, lireTexte } from "@/lib/format";
import { journaliser } from "@/donnees/journal";
import { erreur, ok, type Retour } from "./commun";

export async function creerGrevage(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("grever");
    const position = lireTexte(f.get("position_id"));
    const beneficiaire = lireTexte(f.get("beneficiaire_id"));
    const nominal = lireNombre(f.get("nominal_affecte"));
    const debut = lireDate(f.get("date_debut"));
    if (!position || !beneficiaire) throw new ErreurMetier("Position et bénéficiaire obligatoires.");
    if (!nominal || nominal <= 0) throw new ErreurMetier("Le nominal affecté doit être positif.");
    if (!debut) throw new ErreurMetier("La date de début est obligatoire.");
    const decotePct = lireNombre(f.get("decote_pct"));
    const decote = decotePct === null ? null : decotePct / 100;
    let valeurRetenue = lireNombre(f.get("valeur_retenue"));
    // Valeur retenue proposée : nominal × (1 − décote), si elle n'est pas saisie.
    if (valeurRetenue === null && decote !== null) valeurRetenue = Math.round(nominal * (1 - decote) * 100) / 100;
    const soumettre = lireTexte(f.get("soumettre")) === "1";
    const id = await transaction(s.u.id, async (c) => {
      if (s.u.portefeuilles.length) {
        const p = await c.query<{ portefeuille_id: string }>("select portefeuille_id from positions where id = $1", [position]);
        if (!p.rows[0] || !s.u.portefeuilles.includes(p.rows[0].portefeuille_id)) throw new ErreurMetier("Position hors de votre périmètre.");
      }
      // Contrôle anticipé (la base refera le contrôle à la validation).
      const d = await c.query<{ disponible: number }>("select nominal_actuel - nominal_greve_actif($1) as disponible from positions where id = $1", [position]);
      if (d.rows[0] && nominal > d.rows[0].disponible + 0.005)
        throw new ErreurMetier(`Grevage supérieur au nominal disponible (${d.rows[0].disponible.toLocaleString("fr-FR")}).`);
      const r = await c.query<{ id: string }>(
        `insert into grevages (position_id, beneficiaire_id, nominal_affecte, decote_pct, valeur_retenue, financement_obtenu, date_debut, date_fin,
                               reference_convention, commentaire, statut)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [position, beneficiaire, nominal, decote, valeurRetenue, lireNombre(f.get("financement_obtenu")), debut, lireDate(f.get("date_fin")),
          lireTexte(f.get("reference_convention")), lireTexte(f.get("commentaire")), soumettre ? "soumis" : "brouillon"],
      );
      await c.query("insert into mouvements_grevage (grevage_id, type, nominal_avant, nominal_apres, date, motif, auteur_id) values ($1,'creation',0,$2,$3,'',$4)", [
        r.rows[0].id, nominal, debut, s.u.id,
      ]);
      await journaliser(c, s, "Grevage créé", "grevage", r.rows[0].id, { nominal, soumis: soumettre });
      return r.rows[0].id;
    });
    revalidatePath("/grevages");
    return ok(soumettre ? "Grevage soumis : un validateur (autre que vous) doit l'approuver." : "Grevage enregistré en brouillon.", { id });
  } catch (e) {
    return erreur(e);
  }
}

export async function changerStatutGrevage(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await sessionCourante();
    if (!s) throw new ErreurMetier("Session expirée.");
    const id = lireTexte(f.get("id"));
    const cible = lireTexte(f.get("statut"));
    const motif = lireTexte(f.get("motif"));
    if ((cible === "actif" || cible === "rejete") && !s.peut("valider")) throw new ErreurMetier("Seul un validateur approuve un grevage.");
    if (cible === "leve" && !s.peut("lever_grevage")) throw new ErreurMetier("Droits insuffisants pour la mainlevée.");
    if ((cible === "soumis" || cible === "brouillon") && !s.peut("grever")) throw new ErreurMetier("Droits insuffisants.");
    await transaction(s.u.id, async (c) => {
      const g = await c.query<{ nominal_affecte: number }>("select nominal_affecte from grevages where id = $1 for update", [id]);
      if (!g.rows[0]) throw new ErreurMetier("Grevage introuvable.");
      const champs: Record<string, unknown> = { statut: cible };
      if (cible === "rejete") champs.motif_rejet = motif;
      if (cible === "leve") {
        champs.motif_levee = motif;
        champs.date_fin = lireDate(f.get("date_fin")) ?? new Date().toISOString().slice(0, 10);
      }
      const cles = Object.keys(champs);
      await c.query(`update grevages set ${cles.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [id, ...cles.map((k) => champs[k])]);
      if (cible === "leve")
        await c.query("insert into mouvements_grevage (grevage_id, type, nominal_avant, nominal_apres, date, motif, auteur_id) values ($1,'mainlevee',$2,0,$3,$4,$5)", [
          id, g.rows[0].nominal_affecte, champs.date_fin, motif, s.u.id,
        ]);
      const lib: Record<string, string> = { soumis: "soumis", actif: "validé (actif)", rejete: "rejeté", leve: "levé (mainlevée)", brouillon: "repris en brouillon" };
      await journaliser(c, s, `Grevage ${lib[cible] ?? cible}`, "grevage", id, { motif });
    });
    revalidatePath("/grevages");
    revalidatePath(`/grevages/${id}`);
    return ok("Statut du grevage mis à jour.");
  } catch (e) {
    return erreur(e);
  }
}

/** Augmentation ou réduction d'un grevage actif (l'augmentation repasse par le contrôle du disponible). */
export async function modifierNominalGrevage(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await sessionCourante();
    if (!s) throw new ErreurMetier("Session expirée.");
    const id = lireTexte(f.get("id"));
    const nouveau = lireNombre(f.get("nominal_affecte"));
    const motif = lireTexte(f.get("motif"));
    const date = lireDate(f.get("date")) ?? new Date().toISOString().slice(0, 10);
    if (!nouveau || nouveau <= 0) throw new ErreurMetier("Nouveau nominal positif obligatoire (utilisez la mainlevée pour tout lever).");
    if (!motif) throw new ErreurMetier("Le motif est obligatoire.");
    await transaction(s.u.id, async (c) => {
      const g = await c.query<{ nominal_affecte: number; statut: string }>("select nominal_affecte, statut from grevages where id = $1 for update", [id]);
      if (!g.rows[0] || g.rows[0].statut !== "actif") throw new ErreurMetier("Seul un grevage actif peut être augmenté ou réduit.");
      const avant = g.rows[0].nominal_affecte;
      if (nouveau > avant && !s.peut("valider")) throw new ErreurMetier("Une augmentation doit être faite par un validateur (contrôle du disponible).");
      if (nouveau < avant && !s.peut("lever_grevage")) throw new ErreurMetier("Droits insuffisants pour réduire un grevage.");
      await c.query("update grevages set nominal_affecte = $2 where id = $1", [id, nouveau]);
      await c.query("insert into mouvements_grevage (grevage_id, type, nominal_avant, nominal_apres, date, motif, auteur_id) values ($1,$2,$3,$4,$5,$6,$7)", [
        id, nouveau > avant ? "augmentation" : "reduction", avant, nouveau, date, motif, s.u.id,
      ]);
      await journaliser(c, s, nouveau > avant ? "Grevage augmenté" : "Grevage réduit", "grevage", id, { avant, apres: nouveau, motif });
    });
    revalidatePath(`/grevages/${id}`);
    return ok("Nominal affecté modifié.");
  } catch (e) {
    return erreur(e);
  }
}
