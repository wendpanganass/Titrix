"use server";
/**
 * Arrêtés : photographie validée du portefeuille à une date, verrouillage, réouverture motivée.
 * Un arrêté verrouillé ne peut plus être modifié silencieusement (règles de la base).
 */
import { revalidatePath } from "next/cache";
import { transaction } from "@/lib/db";
import { ErreurMetier, exigerPermission, sessionCourante } from "@/lib/session";
import { lireDate, lireTexte } from "@/lib/format";
import { journaliser } from "@/donnees/journal";
import { analyser } from "@/donnees/portefeuille";
import { photographie } from "@/donnees/arretes";
import { VERSION_MOTEUR } from "@/moteur";
import { erreur, ok, type Retour } from "./commun";

export async function calculerArrete(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("arreter");
    const date = lireDate(f.get("date_arrete"));
    if (!date) throw new ErreurMetier("Date d'arrêté invalide.");
    if (s.u.portefeuilles.length) throw new ErreurMetier("Un arrêté couvre tout le portefeuille : il doit être calculé par un compte sans restriction de périmètre.");
    const a = await analyser(s, date);
    const resultat = photographie(a);
    const id = await transaction(s.u.id, async (c) => {
      const r = await c.query<{ id: string }>(
        `insert into arretes (date_arrete, resultat, version_moteur) values ($1, $2, $3)
         on conflict (date_arrete) do update set resultat = excluded.resultat, version_moteur = excluded.version_moteur
         where arretes.statut <> 'verrouille' returning id`,
        [date, JSON.stringify(resultat), VERSION_MOTEUR],
      );
      if (!r.rows[0]) throw new ErreurMetier("L'arrêté de cette date est verrouillé : rouvrez-le avant de le recalculer.");
      await journaliser(c, s, "Arrêté calculé", "arrete", r.rows[0].id, { date, positions: resultat.lignes.length });
      return r.rows[0].id;
    });
    revalidatePath("/arretes");
    return ok(`Arrêté du ${date} calculé (${resultat.lignes.length} position(s)). Contrôlez-le puis verrouillez-le.`, { id });
  } catch (e) {
    return erreur(e);
  }
}

export async function changerStatutArrete(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await sessionCourante();
    if (!s) throw new ErreurMetier("Session expirée.");
    const id = lireTexte(f.get("id"));
    const cible = lireTexte(f.get("statut"));
    const motif = lireTexte(f.get("motif"));
    if (cible === "verrouille" && !s.peut("verrouiller_arrete")) throw new ErreurMetier("Droits insuffisants pour verrouiller.");
    if (cible === "rouvert" && !s.peut("rouvrir_arrete")) throw new ErreurMetier("Seul un validateur peut rouvrir un arrêté.");
    if (!["verrouille", "rouvert"].includes(cible)) throw new ErreurMetier("Statut inconnu.");
    await transaction(s.u.id, async (c) => {
      await c.query("update arretes set statut = $2, motif_reouverture = case when $2 = 'rouvert' then $3 else motif_reouverture end where id = $1", [id, cible, motif]);
      await journaliser(c, s, cible === "verrouille" ? "Arrêté verrouillé" : "Arrêté rouvert", "arrete", id, { motif });
    });
    revalidatePath("/arretes");
    revalidatePath(`/arretes/${id}`);
    return ok(cible === "verrouille" ? "Arrêté verrouillé : les opérations rétrodatées sur cette période sont désormais bloquées." : "Arrêté rouvert : recalculez-le puis verrouillez-le à nouveau.");
  } catch (e) {
    return erreur(e);
  }
}
