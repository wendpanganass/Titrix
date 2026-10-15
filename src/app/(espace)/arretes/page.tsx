/**
 * Arrêtés : liste, calcul d'un nouvel arrêté, verrouillage.
 */
import Link from "next/link";
import { Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { StatutArrete } from "@/composants/Statuts";
import { Carte, Champ, Message, Vide } from "@/composants/ui";
import { calculerArrete } from "@/app/actions/arretes";
import { lire } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { aujourdhui, dateFr, dateHeureFr, montant } from "@/lib/format";

export default async function Arretes() {
  const s = await exigerSession();
  const arretes = await lire<{ id: string; date_arrete: string; statut: string; version_moteur: string; cree_le: string; auteur: string | null; verrouille_par: string | null; verrouille_le: string | null; totaux: { devise: string; nominal: number }[] | null; positions: number }>(
    `select a.id, a.date_arrete, a.statut, a.version_moteur, a.cree_le, u.nom as auteur, v.nom as verrouille_par, a.verrouille_le,
            a.resultat->'totaux' as totaux, coalesce(jsonb_array_length(a.resultat->'lignes'), 0) as positions
       from arretes a left join utilisateurs u on u.id = a.cree_par left join utilisateurs v on v.id = a.verrouille_par
      order by a.date_arrete desc`,
  );
  const dernierVerrou = arretes.find((a) => a.statut === "verrouille");
  return (
    <>
      <EnTete titre="Arrêtés" sousTitre="Photographies validées du portefeuille ; un arrêté verrouillé protège sa période contre les opérations rétrodatées" />
      <Contenu>
        {dernierVerrou && <Message ton="info">Dernier arrêté verrouillé : {dateFr(dernierVerrou.date_arrete)}. Aucune opération ni aucun encaissement daté de cette date ou d&apos;avant ne peut être validé sans réouverture.</Message>}
        <Carte titre={`${arretes.length} arrêté(s)`} flush>
          {arretes.length === 0 ? <Vide>Aucun arrêté.</Vide> : (
            <div className="tab-wrap">
              <table className="tab">
                <thead><tr><th>Date d&apos;arrêté</th><th>Statut</th><th className="d">Positions</th><th className="d">Encours</th><th>Calculé</th><th>Verrouillé</th><th>Moteur</th></tr></thead>
                <tbody>
                  {arretes.map((a) => (
                    <tr key={a.id}>
                      <td><Link href={`/arretes/${a.id}`}><b>{dateFr(a.date_arrete)}</b></Link></td>
                      <td><StatutArrete s={a.statut} /></td>
                      <td className="d">{a.positions}</td>
                      <td className="d">{(a.totaux ?? []).map((t) => <div key={t.devise}>{montant(t.nominal)} {t.devise}</div>)}</td>
                      <td className="petit">{a.auteur ?? "—"}<div className="mut">{dateHeureFr(a.cree_le)}</div></td>
                      <td className="petit">{a.verrouille_par ? <>{a.verrouille_par}<div className="mut">{dateHeureFr(a.verrouille_le)}</div></> : "—"}</td>
                      <td className="petit mut">{a.version_moteur}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Carte>
        {s.peut("arreter") && (
          <Carte titre="Calculer un arrêté" sousTitre="Situation historique reconstituée à la date, à partir des opérations validées. Un arrêté ouvert peut être recalculé ; verrouillé, il est figé.">
            <Formulaire action={calculerArrete} bouton="Calculer l'arrêté">
              <div className="form-grille quatre">
                <Champ libelle="Date d'arrêté" obligatoire><input className="champ" type="date" name="date_arrete" defaultValue={aujourdhui()} required /></Champ>
              </div>
            </Formulaire>
          </Carte>
        )}
      </Contenu>
    </>
  );
}
