/**
 * Téléchargement d'une pièce justificative (session obligatoire, consultation journalisée).
 */
import { lireUn, transaction } from "@/lib/db";
import { sessionCourante } from "@/lib/session";
import { journaliser } from "@/donnees/journal";

export async function GET(_: Request, ctx: RouteContext<"/pieces/[id]">) {
  const s = await sessionCourante();
  if (!s) return new Response("Session expirée.", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Introuvable.", { status: 404 });
  const p = await lireUn<{ nom: string; type_mime: string; contenu: Buffer; objet: string; objet_id: string }>(
    "select nom, type_mime, contenu, objet, objet_id from pieces where id = $1",
    [id],
  );
  if (!p) return new Response("Introuvable.", { status: 404 });
  await transaction(s.u.id, (c) => journaliser(c, s, "Pièce justificative consultée", p.objet, p.objet_id, { piece: id, nom: p.nom }));
  return new Response(new Uint8Array(p.contenu), {
    headers: {
      "Content-Type": p.type_mime,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(p.nom)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
