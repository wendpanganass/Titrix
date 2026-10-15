/**
 * Modèles d'import vierges : onglet « Import » (lu par l'import, en-têtes en ligne 1, exemple en ligne 2)
 * et onglet « Guide » (rôle du fichier, règles, colonnes).
 */
import ExcelJS from "exceljs";
import { sessionCourante } from "@/lib/session";
import { CHAMPS, type NatureImport } from "@/lib/import-regles";

const EXEMPLES: Record<string, string | number> = {
  code: "CI0000001234-SGI1", isin: "", libelle: "TPCI 6,50 % 2024-2029", emetteur: "État de Côte d'Ivoire", pays: "CI", zone: "UEMOA",
  type: "OAT", devise: "XOF", nominal_unitaire: 10000, date_emission: "15/03/2024", date_echeance: "15/03/2029", taux: "6,50 %",
  frequence: "Annuelle", profil: "Amortissement constant", differe: 2, convention: "ACT/365", conservateur: "SGI Démo", compte: "000123",
  portefeuille: "PF-INV", quantite: 100, nominal: 1000000, classification: "Coût amorti", beneficiaire: "Banque centrale", nominal_greve: 400000,
  date_valeur: "15/03/2026", montant: 265000, reference: "AVIS-2026-001",
};

export async function GET(_: Request, ctx: RouteContext<"/modeles/[nature]">) {
  if (!(await sessionCourante())) return new Response("Session expirée.", { status: 401 });
  const { nature } = await ctx.params;
  if (!(nature in CHAMPS)) return new Response("Modèle inconnu.", { status: 404 });
  const champs = CHAMPS[nature as NatureImport];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Import", { views: [{ state: "frozen", ySplit: 1 }] });
  champs.forEach((c, k) => {
    const cell = ws.getRow(1).getCell(k + 1);
    cell.value = c.libelle;
    cell.font = { name: "Arial Narrow", bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.obligatoire ? "FF1F4E8C" : "FF7C93B5" } };
    cell.note = `${c.obligatoire ? "Obligatoire. " : "Facultatif. "}Synonymes reconnus : ${c.synonymes.join(", ")}`;
    const ex = ws.getRow(2).getCell(k + 1);
    ex.value = EXEMPLES[c.cle] ?? "";
    ex.font = { name: "Arial Narrow", italic: true, color: { argb: "FF94A3B8" } };
    ws.getColumn(k + 1).width = Math.max(14, c.libelle.length + 2);
    if (["code", "compte", "isin"].includes(c.cle)) ws.getColumn(k + 1).numFmt = "@";
  });
  const g = wb.addWorksheet("Guide");
  g.getColumn(1).width = 34;
  g.getColumn(2).width = 14;
  g.getColumn(3).width = 70;
  g.addRow([nature === "base_titres" ? "Modèle d'import — base titres" : "Modèle d'import — encaissements"]).font = { bold: true, size: 14, color: { argb: "FF1F4E8C" } };
  g.addRow([
    nature === "base_titres"
      ? "Une ligne par position (titre × conservateur × compte). L'encours devient une position d'ouverture à la date de reprise, soumise à validation."
      : "Une ligne par encaissement reçu ; il est rapproché de l'échéance la plus proche (±31 jours) de la position.",
  ]);
  g.addRow(["Règles : la ligne 2 est un exemple à remplacer ; dates au format JJ/MM/AAAA ; montants sans séparateur de milliers ; un fichier réimporté ne crée aucun doublon ; une ligne douteuse est placée en quarantaine, jamais corrigée."]);
  g.addRow([]);
  g.addRow(["Colonne", "Obligatoire", "Contenu attendu (synonymes acceptés)"]).font = { bold: true };
  for (const c of champs) g.addRow([c.libelle, c.obligatoire ? "Oui" : "Non", c.synonymes.join(", ")]);
  const tampon = Buffer.from(await wb.xlsx.writeBuffer());
  return new Response(new Uint8Array(tampon), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="modele_import_${nature}.xlsx"`,
    },
  });
}
