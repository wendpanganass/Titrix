/**
 * Import et reprise des données (§11) : dépôt d'un fichier Excel ou CSV, historique des imports.
 */
import Link from "next/link";
import { BoutonAction, Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Badge, Carte, Champ, Message, Vide } from "@/composants/ui";
import { deposerFichier, supprimerImport } from "@/app/actions/imports";
import { lire } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { dateHeureFr } from "@/lib/format";

export default async function Import() {
  const s = await exigerSession();
  const imports = await lire<{ id: string; nom_fichier: string; nature: string; statut: string; nb_lignes: number; nb_importees: number; nb_doublons: number; nb_quarantaine: number; annule: boolean; cree_le: string; auteur: string | null; empreinte: string }>(
    "select i.id, i.nom_fichier, i.nature, i.statut, (i.rapport ? 'annulation') as annule, i.nb_lignes, i.nb_importees, i.nb_doublons, i.nb_quarantaine, i.cree_le, u.nom as auteur, i.empreinte from imports i left join utilisateurs u on u.id = i.cree_par order by i.cree_le desc limit 100",
  );
  return (
    <>
      <EnTete titre="Import et reprise" sousTitre="Reprise du classeur existant : correspondance des colonnes, aperçu des anomalies, aucune fusion automatique" />
      <Contenu>
        <Message ton="info">
          Étapes : 1. figer une copie du classeur ; 2. déposer la feuille « base titres » (.xlsx ou .csv, 4 Mo au plus) ; 3. vérifier la correspondance des colonnes et la date de reprise ;
          4. contrôler l&apos;aperçu (doublons, divergences, quarantaine) ; 5. importer ; 6. faire valider les positions d&apos;ouverture et les instruments par un validateur ;
          7. rapprocher les encours par titre, pays et conservateur (écran Analyses, état Rapprochement). Un fichier importé deux fois ne crée aucun doublon.
        </Message>
        {s.peut("importer") && (
          <Carte titre="Déposer un fichier" sousTitre="Le fichier est lu puis conservé tel quel (source, date, empreinte) ; rien n'est importé avant votre confirmation.">
            <Formulaire action={deposerFichier} bouton="Lire le fichier">
              <div className="form-grille trois">
                <Champ libelle="Nature des données" obligatoire>
                  <select className="champ" name="nature">
                    <option value="base_titres">Base titres (instruments, positions, grevage)</option>
                    <option value="encaissements">Encaissements reçus</option>
                  </select>
                </Champ>
                <Champ libelle="Fichier (.xlsx ou .csv)" obligatoire>
                  <input className="champ" type="file" name="fichier" accept=".xlsx,.csv,.txt" required style={{ paddingTop: 6 }} />
                </Champ>
                <Champ libelle="Feuille à lire (Excel)" aide="Vide = la feuille la plus remplie">
                  <input className="champ" name="feuille" placeholder="BASE" />
                </Champ>
              </div>
            </Formulaire>
            <p className="petit" style={{ marginTop: 14 }}>
              {/* Téléchargements (fichiers Excel), pas des pages : liens simples. */}
              Modèles vierges : <a href="/modeles/base_titres" download>base titres</a> ·{" "}
              <a href="/modeles/encaissements" download>encaissements</a> (onglet « Import » + onglet « Guide »).
            </p>
          </Carte>
        )}
        <Carte titre="Historique des imports" flush>
          {imports.length === 0 ? <Vide>Aucun import.</Vide> : (
            <div className="tab-wrap">
              <table className="tab">
                <thead><tr><th>Fichier</th><th>Nature</th><th>Déposé</th><th className="d">Lignes</th><th className="d">Importées</th><th className="d">Doublons</th><th className="d">Quarantaine</th><th>Statut</th>{s.peut("importer") && <th className="noprint">Actions</th>}</tr></thead>
                <tbody>
                  {imports.map((i) => (
                    <tr key={i.id}>
                      <td><Link href={`/import/${i.id}`}>{i.nom_fichier}</Link><div className="petit mut" title="Empreinte SHA-256 du fichier">{i.empreinte.slice(0, 16)}…</div></td>
                      <td>{i.nature === "base_titres" ? "Base titres" : "Encaissements"}</td>
                      <td className="petit">{i.auteur}<div className="mut">{dateHeureFr(i.cree_le)}</div></td>
                      <td className="d">{i.nb_lignes}</td>
                      <td className="d">{i.nb_importees}</td>
                      <td className="d">{i.nb_doublons}</td>
                      <td className="d">{i.nb_quarantaine}</td>
                      <td><Badge ton={i.statut === "importe" ? "bon" : i.statut === "analyse" ? "alerte" : "gris"}>{i.statut === "importe" ? "Importé" : i.statut === "analyse" ? "En analyse" : i.annule ? "Annulé" : "Abandonné"}</Badge></td>
                      {s.peut("importer") && (
                        <td className="noprint">
                          {i.statut === "importe" ? (
                            <Link className="btn-sec btn-mini" href={`/import/${i.id}`}>Annuler…</Link>
                          ) : !i.annule ? (
                            <BoutonAction action={supprimerImport} champs={{ id: i.id }} libelle="Supprimer" classe="btn-danger btn-mini" confirmation={`Supprimer « ${i.nom_fichier} » de l'historique ? Cet import n'a jamais été exécuté : aucune donnée n'est touchée.`} />
                          ) : (
                            <span className="petit mut">Conservé (traçabilité)</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Carte>
      </Contenu>
    </>
  );
}
