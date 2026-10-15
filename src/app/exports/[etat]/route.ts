/**
 * Téléchargement des états (Excel ou CSV). Chaque export est journalisé (export sensible).
 * Paramètres : ?date=AAAA-MM-JJ&devise=XOF&format=xlsx|csv (&arrete=<id> pour un arrêté figé).
 */
import { transaction } from "@/lib/db";
import { sessionCourante } from "@/lib/session";
import { Classeur, versCsv } from "@/lib/excel";
import { construireEtat, ETATS, type NomEtat } from "@/donnees/etats";
import { journaliser } from "@/donnees/journal";

export async function GET(req: Request, ctx: RouteContext<"/exports/[etat]">) {
  const s = await sessionCourante();
  if (!s) return new Response("Session expirée : reconnectez-vous.", { status: 401 });
  if (!s.peut("exporter")) return new Response("Droits insuffisants.", { status: 403 });
  const { etat } = await ctx.params;
  if (!(etat in ETATS)) return new Response("État inconnu.", { status: 404 });
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const e = await construireEtat(s, etat as NomEtat, {
    date: url.searchParams.get("date"),
    devise: url.searchParams.get("devise"),
    arrete: url.searchParams.get("arrete"),
  });
  await transaction(s.u.id, (c) =>
    journaliser(c, s, `Export ${format.toUpperCase()} : ${e.titre}`, "export", etat, { date: e.date, devise: e.devise, lignes: e.feuilles.reduce((t, f) => t + f.lignes.length, 0) }),
  );
  const nom = `titrix_${etat}_${e.date}`;
  if (format === "csv") {
    const f = e.feuilles[0];
    return new Response(versCsv(f.colonnes, f.lignes), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nom}.csv"`, "Cache-Control": "no-store" },
    });
  }
  const c = new Classeur({
    titre: e.titre,
    etablissement: e.etablissement,
    dateArrete: e.date,
    filtres: e.filtres,
    devise: e.devise,
    unite: "Unités de devise (non arrondies au millier)",
    auteur: s.u.nom,
  });
  for (const f of e.feuilles) c.feuille(f.nom, f.contenu, f.colonnes, f.lignes);
  const tampon = await c.tampon();
  return new Response(new Uint8Array(tampon), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nom}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
