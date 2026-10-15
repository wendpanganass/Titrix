"use server";
/**
 * Import et reprise : dépôt du fichier, correspondance des colonnes, aperçu, exécution, abandon.
 */
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { lireUn, transaction } from "@/lib/db";
import { ErreurMetier, exigerPermission } from "@/lib/session";
import { lireDate, lireTexte } from "@/lib/format";
import { lireCsv, lireXlsx } from "@/lib/lecture-fichier";
import { CHAMPS, devinerCorrespondance, type NatureImport } from "@/lib/import-regles";
import { journaliser } from "@/donnees/journal";
import { analyserImport, executerImport, type ImportEnBase } from "@/donnees/imports";
import { regenererEcheances } from "@/donnees/echeances";
import { lireParametres } from "@/donnees/referentiels";
import { erreur, ok, type Retour } from "./commun";

const TAILLE_MAX = 4 * 1024 * 1024;

export async function deposerFichier(_: Retour, f: FormData): Promise<Retour> {
  let id = "";
  try {
    const s = await exigerPermission("importer");
    const nature = lireTexte(f.get("nature")) as NatureImport;
    if (!(nature in CHAMPS)) throw new ErreurMetier("Nature d'import inconnue.");
    const fichier = f.get("fichier");
    if (!(fichier instanceof File) || fichier.size === 0) throw new ErreurMetier("Choisissez un fichier Excel (.xlsx) ou CSV.");
    if (fichier.size > TAILLE_MAX) throw new ErreurMetier(`Fichier trop volumineux (${(fichier.size / 1048576).toFixed(1)} Mo) : 4 Mo au plus. Enregistrez la seule feuille utile, ou en CSV.`);
    const contenu = await fichier.arrayBuffer();
    const nom = fichier.name;
    let lu;
    if (/\.xlsx$/i.test(nom)) lu = await lireXlsx(contenu, lireTexte(f.get("feuille")) || undefined);
    else if (/\.(csv|txt)$/i.test(nom)) lu = lireCsv(new TextDecoder("utf-8").decode(contenu));
    else throw new ErreurMetier("Format non pris en charge : utilisez .xlsx ou .csv (un .xls doit d'abord être enregistré en .xlsx).");
    if (!lu.lignes.length) throw new ErreurMetier("Aucune ligne de données trouvée.");
    const empreinte = createHash("sha256").update(Buffer.from(contenu)).digest("hex");
    const p = await lireParametres();
    const correspondance = { colonnes: devinerCorrespondance(nature, lu.entetes), devise: p.deviseReference, portefeuille: "PF-INV", dateReprise: "" };
    id = await transaction(s.u.id, async (c) => {
      const r = await c.query<{ id: string }>(
        "insert into imports (nom_fichier, empreinte, nature, correspondance, lignes, nb_lignes, cree_par) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        [nom, empreinte, nature, JSON.stringify(correspondance), JSON.stringify(lu), lu.lignes.length, s.u.id],
      );
      await journaliser(c, s, "Fichier déposé pour import", "import", r.rows[0].id, { nom, lignes: lu.lignes.length, feuille: lu.feuille });
      return r.rows[0].id;
    });
  } catch (e) {
    return erreur(e);
  }
  redirect(`/import/${id}`);
}

async function chargerImport(id: string): Promise<ImportEnBase> {
  const imp = await lireUn<ImportEnBase>("select id, nom_fichier, nature, correspondance, lignes, statut from imports where id = $1", [id]);
  if (!imp) throw new ErreurMetier("Import introuvable.");
  return imp;
}

export async function enregistrerCorrespondance(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("importer");
    const id = lireTexte(f.get("id"));
    const imp = await chargerImport(id);
    if (imp.statut !== "analyse") throw new ErreurMetier("Cet import est déjà terminé.");
    const colonnes: Record<string, number | null> = {};
    for (const champ of CHAMPS[imp.nature]) {
      const v = lireTexte(f.get(`col_${champ.cle}`));
      colonnes[champ.cle] = v === "" ? null : Number(v);
    }
    const manquants = CHAMPS[imp.nature].filter((c) => c.obligatoire && colonnes[c.cle] === null).map((c) => c.libelle);
    if (manquants.length) throw new ErreurMetier(`Associez une colonne aux champs obligatoires : ${manquants.join(", ")}.`);
    const correspondance = {
      colonnes,
      dateReprise: lireDate(f.get("date_reprise")) ?? "",
      portefeuille: lireTexte(f.get("portefeuille")) || "PF-INV",
      devise: lireTexte(f.get("devise")).toUpperCase() || "XOF",
    };
    const rapport = await transaction(s.u.id, async (c) => {
      const r = await analyserImport(c, { ...imp, correspondance });
      await c.query("update imports set correspondance = $2, rapport = $3 where id = $1", [id, JSON.stringify(correspondance), JSON.stringify(r)]);
      return r;
    });
    revalidatePath(`/import/${id}`);
    if (rapport.erreurGlobale) return { ok: false, message: rapport.erreurGlobale };
    return ok(`Aperçu prêt : ${rapport.totaux.importer} ligne(s) à importer, ${rapport.totaux.doublon} doublon(s), ${rapport.totaux.quarantaine} en quarantaine.`);
  } catch (e) {
    return erreur(e);
  }
}

export async function lancerImport(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("importer");
    const id = lireTexte(f.get("id"));
    const imp = await chargerImport(id);
    if (imp.statut !== "analyse") throw new ErreurMetier("Cet import est déjà terminé.");
    const p = await lireParametres();
    const rapport = await transaction(s.u.id, async (c) => {
      const r = await executerImport(c, imp, s.u.id, p.conventionDefaut);
      if (r.erreurGlobale) throw new ErreurMetier(r.erreurGlobale);
      // Échéances des positions concernées par des encaissements (statuts à jour).
      if (imp.nature === "encaissements") {
        const pos = await c.query<{ position_id: string }>("select distinct position_id from encaissements where import_id = $1", [id]);
        for (const x of pos.rows) await regenererEcheances(c, x.position_id);
      }
      await journaliser(c, s, "Import exécuté", "import", id, r.totaux);
      return r;
    });
    revalidatePath("/", "layout");
    return ok(
      `Import terminé : ${rapport.totaux.importer} ligne(s) importée(s), ${rapport.totaux.doublon} doublon(s) ignoré(s), ${rapport.totaux.quarantaine} ligne(s) en quarantaine.` +
        (imp.nature === "base_titres" ? " Les positions d'ouverture sont « soumises » : un validateur doit les valider (Opérations → À valider par moi)." : ""),
    );
  } catch (e) {
    return erreur(e);
  }
}

export async function abandonnerImport(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("importer");
    const id = lireTexte(f.get("id"));
    await transaction(s.u.id, async (c) => {
      await c.query("update imports set statut = 'abandonne' where id = $1 and statut = 'analyse'", [id]);
      await journaliser(c, s, "Import abandonné", "import", id);
    });
    revalidatePath("/import");
    return ok("Import abandonné (le fichier lu reste conservé pour traçabilité).");
  } catch (e) {
    return erreur(e);
  }
}
