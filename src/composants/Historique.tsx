/**
 * Historique d'audit d'une ligne : auteur, date, champs modifiés (ancienne → nouvelle valeur).
 */
import { lireAudit } from "@/donnees/journal";
import { dateHeureFr } from "@/lib/format";
import { Carte, Vide } from "./ui";

const IGNORES = new Set(["version", "modifie_le", "cree_le", "genere_le", "nominal_actuel", "quantite_actuelle"]);

function texte(v: unknown): string {
  if (v === null || v === undefined || v === "") return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export async function Historique({ table, id, titre = "Historique des modifications" }: { table: string; id: string; titre?: string }) {
  const lignes = await lireAudit(table, id);
  return (
    <Carte titre={titre} sousTitre="Audit automatique : auteur, date, ancienne et nouvelle valeur" flush>
      {lignes.length === 0 ? (
        <Vide>Aucune modification enregistrée.</Vide>
      ) : (
        <div className="tab-wrap">
          <table className="tab">
            <thead>
              <tr><th>Date</th><th>Auteur</th><th>Action</th><th>Champs modifiés</th></tr>
            </thead>
            <tbody>
              {lignes.map((l) => {
                const champs =
                  l.operation === "UPDATE"
                    ? Object.keys(l.nouveau ?? {}).filter((k) => !IGNORES.has(k) && texte(l.ancien?.[k]) !== texte(l.nouveau?.[k]))
                    : [];
                // Recalcul automatique sans changement visible : ligne masquée (elle reste dans l'audit).
                if (l.operation === "UPDATE" && champs.length === 0) return null;
                return (
                  <tr key={l.id}>
                    <td className="nowrap">{dateHeureFr(l.date)}</td>
                    <td>{l.utilisateur ?? "Système"}</td>
                    <td>{l.operation === "INSERT" ? "Création" : l.operation === "UPDATE" ? "Modification" : "Suppression"}</td>
                    <td className="petit">
                      {champs.length === 0
                        ? "—"
                        : champs.map((k) => (
                            <div key={k}>
                              <b>{k.replace(/_/g, " ")}</b> : <span className="mut">{texte(l.ancien?.[k])}</span> → {texte(l.nouveau?.[k])}
                            </div>
                          ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Carte>
  );
}
