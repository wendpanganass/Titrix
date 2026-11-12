/**
 * Lignes en quarantaine d'un import, à corriger dans Excel puis à réimporter (écran Import et reprise).
 * Les colonnes et valeurs d'origine sont conservées ; deux colonnes techniques sont ajoutées à droite :
 * le motif (pour mémoire) et la référence de quarantaine, qui clôt chaque ligne intégrée à la réimport.
 */
import ExcelJS from "exceljs";
import { lire, lireUn, transaction } from "@/lib/db";
import { sessionCourante } from "@/lib/session";
import { ENTETE_MOTIF_QUARANTAINE, ENTETE_REF_QUARANTAINE } from "@/lib/import-regles";
import type { ImportEnBase } from "@/donnees/imports";
import { journaliser } from "@/donnees/journal";

export async function GET(_: Request, ctx: RouteContext<"/exports/quarantaine/[id]">) {
  const s = await sessionCourante();
  if (!s) return new Response("Session expirée : reconnectez-vous.", { status: 401 });
  if (!s.peut("importer")) return new Response("Réservé aux profils qui importent (back-office, administrateur).", { status: 403 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Import inconnu.", { status: 404 });
  const imp = await lireUn<ImportEnBase>("select id, nom_fichier, nature, correspondance, lignes, statut from imports where id = $1", [id]);
  if (!imp) return new Response("Import inconnu.", { status: 404 });
  const lignes = await lire<{ id: string; numero_ligne: number; motif: string }>(
    "select id, numero_ligne, motif from quarantaine where import_id = $1 and statut = 'ouverte' order by numero_ligne",
    [id],
  );

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Import", { views: [{ state: "frozen", ySplit: 1 }] });
  const entetes = [...imp.lignes.entetes, ENTETE_MOTIF_QUARANTAINE, ENTETE_REF_QUARANTAINE];
  entetes.forEach((e, k) => {
    const cell = ws.getRow(1).getCell(k + 1);
    cell.value = e;
    const technique = k >= imp.lignes.entetes.length;
    cell.font = { name: "Arial Narrow", bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: technique ? "FF94A3B8" : "FF1F4E8C" } };
    ws.getColumn(k + 1).width = technique ? (k === entetes.length - 1 ? 40 : 60) : 18;
  });
  lignes.forEach((q, r) => {
    const brut = imp.lignes.lignes[q.numero_ligne - 2] ?? [];
    const row = ws.getRow(r + 2);
    imp.lignes.entetes.forEach((_, k) => (row.getCell(k + 1).value = brut[k] ?? null));
    row.getCell(imp.lignes.entetes.length + 1).value = q.motif;
    row.getCell(imp.lignes.entetes.length + 2).value = q.id;
    for (const k of [imp.lignes.entetes.length + 1, imp.lignes.entetes.length + 2]) row.getCell(k).font = { name: "Arial Narrow", color: { argb: "FF64748B" } };
  });

  const guide = wb.addWorksheet("Guide");
  guide.getColumn(1).width = 110;
  const reprise = imp.correspondance.dateReprise ? imp.correspondance.dateReprise.split("-").reverse().join("/") : "";
  const texte = [
    `Lignes en quarantaine du fichier « ${imp.nom_fichier} » (${lignes.length} ligne(s) ouverte(s)).`,
    "",
    "1. Corrigez les valeurs dans l'onglet « Import » (la colonne « Motif » indique le problème de chaque ligne).",
    "2. Ne modifiez pas la colonne « Réf. quarantaine Titrix » : elle permet de clore automatiquement chaque ligne intégrée.",
    "   Supprimez les lignes que vous ne voulez pas intégrer (rejetez-les ensuite dans Alertes et anomalies).",
    "3. Titrix → Import et reprise → déposez ce fichier (même nature de données), feuille « Import ».",
    imp.nature === "base_titres" ? `4. Reprenez la même date de reprise que l'import d'origine${reprise ? ` : ${reprise}` : ""}, calculez l'aperçu puis « Importer ».` : "4. Calculez l'aperçu puis « Importer ».",
    "",
    "Chaque ligne intégrée passe en « Corrigée » dans la quarantaine ; une ligne encore refusée reste ouverte avec son nouveau motif.",
  ].join("\n");
  // Une seule cellule : à la réimport, Titrix lit par défaut la feuille la plus remplie (l'onglet « Import »).
  guide.getCell(1, 1).value = texte;
  guide.getCell(1, 1).alignment = { wrapText: true, vertical: "top" };
  guide.getCell(1, 1).font = { name: "Arial Narrow", size: 11 };
  guide.getRow(1).height = 190;

  await transaction(s.u.id, (c) => journaliser(c, s, "Export des lignes en quarantaine pour correction", "import", id, { lignes: lignes.length }));
  const nom = `titrix_quarantaine_${imp.nom_fichier.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_").slice(0, 60)}.xlsx`;
  return new Response(new Uint8Array(await wb.xlsx.writeBuffer()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nom}"`,
      "Cache-Control": "no-store",
    },
  });
}
