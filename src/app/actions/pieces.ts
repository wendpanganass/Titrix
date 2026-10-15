"use server";
/**
 * Pièces justificatives : fichiers de 4 Mo au plus, conservés dans la base, jamais publics.
 */
import { revalidatePath } from "next/cache";
import { transaction } from "@/lib/db";
import { ErreurMetier, sessionCourante } from "@/lib/session";
import { lireTexte } from "@/lib/format";
import { journaliser } from "@/donnees/journal";
import { erreur, ok, type Retour } from "./commun";

const TAILLE_MAX = 4 * 1024 * 1024;
const TYPES = /\.(pdf|png|jpe?g|xlsx?|csv|docx?|txt|msg|eml)$/i;
const OBJETS = ["operation", "grevage", "instrument", "encaissement", "arrete"];

export async function deposerPiece(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await sessionCourante();
    if (!s) throw new ErreurMetier("Session expirée.");
    if (s.u.roles.every((r) => ["direction", "auditeur"].includes(r))) throw new ErreurMetier("Votre profil est en consultation seule.");
    const objet = lireTexte(f.get("objet"));
    const objetId = lireTexte(f.get("objet_id"));
    const fichier = f.get("fichier");
    if (!OBJETS.includes(objet)) throw new ErreurMetier("Objet inconnu.");
    if (!(fichier instanceof File) || fichier.size === 0) throw new ErreurMetier("Choisissez un fichier.");
    if (fichier.size > TAILLE_MAX) throw new ErreurMetier(`Fichier trop volumineux (${(fichier.size / 1048576).toFixed(1)} Mo) : 4 Mo au plus.`);
    if (!TYPES.test(fichier.name)) throw new ErreurMetier("Format non accepté (PDF, image, Excel, CSV, Word, texte, e-mail).");
    const contenu = Buffer.from(await fichier.arrayBuffer());
    await transaction(s.u.id, async (c) => {
      const r = await c.query<{ id: string }>(
        "insert into pieces (objet, objet_id, nom, type_mime, taille, contenu, depose_par) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        [objet, objetId, fichier.name.slice(0, 200), fichier.type || "application/octet-stream", fichier.size, contenu, s.u.id],
      );
      await journaliser(c, s, "Pièce justificative déposée", objet, objetId, { piece: r.rows[0].id, nom: fichier.name });
    });
    revalidatePath("/", "layout");
    return ok(`« ${fichier.name} » déposé.`);
  } catch (e) {
    return erreur(e);
  }
}
