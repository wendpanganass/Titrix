/**
 * Classeurs Excel produits par Titrix (charte : couverture + sommaire cliquable, en-têtes marine,
 * volets figés, filtres automatiques, totaux par formule SOUS.TOTAL avec la valeur calculée fournie).
 */
import "server-only";
import ExcelJS from "exceljs";

export type FormatColonne = "texte" | "montant" | "montant2" | "pourcent" | "date" | "entier";
export interface Colonne {
  titre: string;
  cle: string;
  format?: FormatColonne;
  largeur?: number;
  total?: boolean;
}
export type Ligne = Record<string, string | number | null | undefined>;

const MARINE = "FF1F4E8C";
const GRIS_BLEU = "FFE7EDF6";
const POLICE = "Arial Narrow";

const FORMATS: Record<FormatColonne, string | undefined> = {
  texte: undefined,
  montant: '#,##0;-#,##0;"–"',
  montant2: '#,##0.00;-#,##0.00;"–"',
  pourcent: "0.00%",
  date: "dd/mm/yyyy",
  entier: "0",
};

function versDate(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  return new Date(`${v.slice(0, 10)}T00:00:00Z`);
}

export interface Contexte {
  titre: string;
  etablissement: string;
  dateArrete: string;
  filtres: string;
  devise: string;
  unite: string;
  auteur: string;
}

export class Classeur {
  private wb = new ExcelJS.Workbook();
  private sommaire: { nom: string; contenu: string; lignes: number }[] = [];
  private couverture: ExcelJS.Worksheet;

  constructor(private ctx: Contexte) {
    this.wb.creator = ctx.auteur;
    this.wb.created = new Date();
    this.couverture = this.wb.addWorksheet("Couverture", { views: [{ showGridLines: false }], properties: { tabColor: { argb: MARINE } } });
  }

  feuille(nom: string, contenu: string, colonnes: Colonne[], lignes: Ligne[]) {
    const ws = this.wb.addWorksheet(nom.slice(0, 31), {
      views: [{ state: "frozen", ySplit: 3, showGridLines: false }],
      properties: { tabColor: { argb: nom.startsWith("Anomalies") ? "FFDC2626" : MARINE } },
      pageSetup: { orientation: colonnes.length > 7 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "3:3" },
      headerFooter: { oddFooter: `&L${this.ctx.etablissement} · ${this.ctx.titre}&RPage &P / &N` },
    });
    ws.getCell("A1").value = contenu;
    ws.getCell("A1").font = { name: POLICE, size: 14, bold: true, color: { argb: MARINE } };
    ws.getCell("A2").value = `${this.ctx.etablissement} · arrêté au ${this.ctx.dateArrete.split("-").reverse().join("/")} · ${this.ctx.devise} · ${this.ctx.unite}`;
    ws.getCell("A2").font = { name: POLICE, size: 10, color: { argb: "FF64748B" } };
    const retour = ws.getCell(2, Math.max(colonnes.length, 2));
    retour.value = { text: "↩ Sommaire", hyperlink: "#'Couverture'!A1" };
    retour.font = { name: POLICE, size: 10, color: { argb: MARINE }, underline: true };
    retour.alignment = { horizontal: "right" };

    const entete = ws.getRow(3);
    colonnes.forEach((c, k) => {
      const cell = entete.getCell(k + 1);
      cell.value = c.titre;
      cell.font = { name: POLICE, bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MARINE } };
      cell.alignment = { vertical: "middle", wrapText: true, horizontal: c.format && c.format !== "texte" && c.format !== "date" ? "right" : "left" };
      ws.getColumn(k + 1).width = c.largeur ?? (c.format === "texte" || !c.format ? 22 : 15);
    });
    entete.height = 30;
    lignes.forEach((l, i) => {
      const row = ws.getRow(4 + i);
      colonnes.forEach((c, k) => {
        const cell = row.getCell(k + 1);
        const v = l[c.cle];
        cell.value = c.format === "date" ? (versDate(v) ?? (v as string) ?? null) : (v ?? null);
        if (c.format && FORMATS[c.format]) cell.numFmt = FORMATS[c.format]!;
        cell.font = { name: POLICE, size: 10 };
        cell.border = { bottom: { style: "hair", color: { argb: "FFE2E7F0" } } };
      });
    });
    const fin = 3 + lignes.length;
    if (lignes.length) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: fin, column: colonnes.length } };
    // Ligne de total : formule SOUS.TOTAL (insensible aux filtres) + valeur calculée.
    if (colonnes.some((c) => c.total)) {
      const row = ws.getRow(fin + 1);
      row.getCell(1).value = "Total";
      colonnes.forEach((c, k) => {
        const cell = row.getCell(k + 1);
        if (c.total) {
          const lettre = ws.getColumn(k + 1).letter;
          const somme = lignes.reduce((t, l) => t + (Number(l[c.cle]) || 0), 0);
          cell.value = { formula: `SUBTOTAL(9,${lettre}4:${lettre}${Math.max(fin, 4)})`, result: Math.round(somme * 100) / 100 };
          if (c.format && FORMATS[c.format]) cell.numFmt = FORMATS[c.format]!;
        }
        cell.font = { name: POLICE, size: 10, bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS_BLEU } };
        cell.border = { top: { style: "thin" }, bottom: { style: "double" } };
      });
    }
    this.sommaire.push({ nom: ws.name, contenu, lignes: lignes.length });
    return this;
  }

  private remplirCouverture() {
    const ws = this.couverture;
    ws.getColumn(1).width = 4;
    ws.getColumn(2).width = 34;
    ws.getColumn(3).width = 60;
    ws.getColumn(4).width = 12;
    const t = (r: number, v: string, taille = 11, gras = false, couleur = "FF0F1729") => {
      const c = ws.getCell(r, 2);
      c.value = v;
      c.font = { name: POLICE, size: taille, bold: gras, color: { argb: couleur } };
    };
    t(2, "TITRIX · gestion des titres financiers", 10, true, MARINE);
    t(3, this.ctx.titre, 18, true);
    t(4, this.ctx.etablissement, 11, false, "FF64748B");
    const info: [string, string][] = [
      ["Date d'arrêté", this.ctx.dateArrete.split("-").reverse().join("/")],
      ["Filtres appliqués", this.ctx.filtres || "Aucun"],
      ["Devise", this.ctx.devise],
      ["Unité des montants", this.ctx.unite],
      ["Date de génération", new Date().toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" })],
      ["Produit par", this.ctx.auteur],
    ];
    ws.getCell(6, 2).value = "Identification";
    ws.getCell(6, 2).font = { name: POLICE, bold: true, color: { argb: MARINE } };
    info.forEach(([k, v], i) => {
      ws.getCell(7 + i, 2).value = k;
      ws.getCell(7 + i, 2).font = { name: POLICE, color: { argb: "FF64748B" } };
      ws.getCell(7 + i, 3).value = v;
      ws.getCell(7 + i, 3).font = { name: POLICE, bold: true };
    });
    const debut = 8 + info.length;
    ws.getCell(debut, 2).value = "Sommaire";
    ws.getCell(debut, 2).font = { name: POLICE, bold: true, color: { argb: MARINE } };
    this.sommaire.forEach((s, i) => {
      const c = ws.getCell(debut + 1 + i, 2);
      c.value = { text: s.nom, hyperlink: `#'${s.nom}'!A1` };
      c.font = { name: POLICE, color: { argb: MARINE }, underline: true };
      ws.getCell(debut + 1 + i, 3).value = s.contenu;
      ws.getCell(debut + 1 + i, 3).font = { name: POLICE };
      ws.getCell(debut + 1 + i, 4).value = `${s.lignes} ligne(s)`;
      ws.getCell(debut + 1 + i, 4).font = { name: POLICE, color: { argb: "FF64748B" } };
    });
    const g = debut + 3 + this.sommaire.length;
    ws.getCell(g, 2).value = "Lecture du classeur";
    ws.getCell(g, 2).font = { name: POLICE, bold: true, color: { argb: MARINE } };
    ws.getCell(g + 1, 2).value =
      "Montants dans la devise indiquée, non convertis. Les totaux sont des formules SOUS.TOTAL : ils suivent les filtres appliqués. « – » signifie zéro.";
    ws.mergeCells(g + 1, 2, g + 1, 4);
    ws.getCell(g + 1, 2).alignment = { wrapText: true, vertical: "top" };
    ws.getRow(g + 1).height = 32;
  }

  async tampon(): Promise<Buffer> {
    this.remplirCouverture();
    return Buffer.from(await this.wb.xlsx.writeBuffer());
  }
}

/** CSV au format français (séparateur « ; », virgule décimale, BOM pour Excel). */
export function versCsv(colonnes: Colonne[], lignes: Ligne[]): string {
  const echapper = (v: unknown, f?: FormatColonne) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return f === "pourcent" ? String(v * 100).replace(".", ",") : String(v).replace(".", ",");
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const tete = colonnes.map((c) => echapper(c.titre)).join(";");
  const corps = lignes.map((l) => colonnes.map((c) => echapper(l[c.cle], c.format)).join(";"));
  return "﻿" + [tete, ...corps].join("\r\n");
}
