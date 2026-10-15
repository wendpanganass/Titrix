/**
 * Pièces justificatives attachées à un objet (opération, grevage…).
 */
import { lire } from "@/lib/db";
import { dateHeureFr } from "@/lib/format";
import { deposerPiece } from "@/app/actions/pieces";
import { Formulaire } from "./client/Formulaire";
import { Carte, Vide } from "./ui";

export async function Pieces({ objet, id, depot = true }: { objet: string; id: string; depot?: boolean }) {
  const pieces = await lire<{ id: string; nom: string; taille: number; depose_par: string | null; depose_le: string }>(
    "select p.id, p.nom, p.taille, u.nom as depose_par, p.depose_le from pieces p left join utilisateurs u on u.id = p.depose_par where objet = $1 and objet_id = $2 order by depose_le desc",
    [objet, id],
  );
  return (
    <Carte titre="Pièces justificatives" sousTitre="4 Mo au plus par fichier · téléchargements journalisés">
      {pieces.length === 0 ? (
        <Vide>Aucune pièce.</Vide>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {pieces.map((p) => (
            <li key={p.id} className="petit" style={{ marginBottom: 6 }}>
              <a href={`/pieces/${p.id}`}>{p.nom}</a> <span className="mut">· {(p.taille / 1024).toFixed(0)} Ko · {p.depose_par ?? "—"}, {dateHeureFr(p.depose_le)}</span>
            </li>
          ))}
        </ul>
      )}
      {depot && (
        <Formulaire action={deposerPiece} bouton="Déposer" boutonClasse="btn-sec" reinitialiser>
          <input type="hidden" name="objet" value={objet} />
          <input type="hidden" name="objet_id" value={id} />
          <input type="file" name="fichier" className="champ" style={{ marginTop: 12, paddingTop: 6 }} accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.doc,.docx,.txt,.msg,.eml" />
        </Formulaire>
      )}
    </Carte>
  );
}
