/**
 * Import : correspondance des colonnes (configurable), aperçu ligne par ligne, exécution.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { BoutonAction, Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Badge, Carte, Champ, Indicateur, Message, Vide } from "@/composants/ui";
import { abandonnerImport, annulerImport, enregistrerCorrespondance, lancerImport, supprimerImport } from "@/app/actions/imports";
import type { ImportEnBase, Rapport } from "@/donnees/imports";
import { listesReferentiels } from "@/donnees/referentiels";
import { lireUn } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { CHAMPS } from "@/lib/import-regles";

export default async function DetailImport(props: PageProps<"/import/[id]">) {
  const s = await exigerSession();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const imp = await lireUn<ImportEnBase & { rapport: Rapport | Record<string, never> }>("select id, nom_fichier, nature, correspondance, lignes, statut, rapport from imports where id = $1", [id]);
  if (!imp) notFound();
  const r = await listesReferentiels();
  const rapport = "lignes" in imp.rapport ? (imp.rapport as Rapport) : null;
  const corr = imp.correspondance.colonnes;
  const entetes = imp.lignes.entetes;
  const enAnalyse = imp.statut === "analyse" && s.peut("importer");

  return (
    <>
      <EnTete titre={`Import — ${imp.nom_fichier}`} sousTitre={`${imp.nature === "base_titres" ? "Base titres" : "Encaissements"} · feuille « ${imp.lignes.feuille} » · ${imp.lignes.lignes.length} ligne(s) lue(s)`} />
      <Contenu>
        <p className="petit noprint"><Link href="/import">← Imports</Link></p>
        {imp.statut === "importe" && <Message ton="bon">Import terminé. Les lignes en quarantaine sont consultables dans <Link href="/controles">Alertes et anomalies</Link>.</Message>}
        {imp.statut === "importe" && (s.peut("importer") || s.peut("valider")) && (
          <Carte titre="Supprimer ou remplacer cet import" sousTitre="Pour remplacer : annulez cet import, puis déposez le fichier corrigé (écran Import et reprise).">
            <p className="petit" style={{ marginTop: 0 }}>
              L&apos;annulation retire les positions d&apos;ouverture encore non validées, annule celles déjà validées (elles restent visibles,
              barrées — un validateur autre que l&apos;importateur doit alors le faire), neutralise les grevages et encaissements importés,
              supprime les positions et instruments créés par cet import devenus sans objet, et libère les lignes pour un nouvel import.
              Les référentiels créés (conservateurs, émetteurs…) sont conservés. Tout est journalisé.
            </p>
            <BoutonAction action={annulerImport} champs={{ id }} libelle="Annuler cet import" classe="btn-danger btn-mini" motif="Motif de l'annulation (ex. : fichier corrigé à réimporter) :" />
          </Carte>
        )}
        {imp.statut === "abandonne" && (
          <Message ton="info">
            {"annulation" in imp.rapport ? "Import annulé : ses données ont été retirées ou annulées ; ses lignes peuvent être réimportées." : "Import abandonné avant exécution."}
          </Message>
        )}

        {enAnalyse && (
          <div className="actions noprint" style={{ marginBottom: 14 }}>
            <BoutonAction action={supprimerImport} champs={{ id, retour: "liste" }} libelle="Supprimer ce fichier lu (jamais importé)" classe="btn-danger btn-mini" confirmation="Supprimer ce fichier de l'historique ? Il n'a jamais été importé : aucune donnée n'est touchée." />
          </div>
        )}
        {enAnalyse && (
          <Carte titre="1. Correspondance des colonnes" sousTitre="Proposée d'après les en-têtes du fichier : corrigez-la si besoin, puis calculez l'aperçu.">
            <Formulaire action={enregistrerCorrespondance} bouton="Enregistrer et calculer l'aperçu">
              <input type="hidden" name="id" value={id} />
              <div className="form-grille quatre">
                {imp.nature === "base_titres" && (
                  <>
                    <Champ libelle="Date de reprise (position d'ouverture)" obligatoire aide="Les périodes antérieures ne seront pas présentées comme reconstituées">
                      <input className="champ" type="date" name="date_reprise" defaultValue={imp.correspondance.dateReprise ?? ""} required />
                    </Champ>
                    <Champ libelle="Portefeuille par défaut">
                      <select className="champ" name="portefeuille" defaultValue={imp.correspondance.portefeuille ?? "PF-INV"}>
                        {r.portefeuilles.map((p) => <option key={p.id} value={p.code}>{p.libelle}</option>)}
                      </select>
                    </Champ>
                    <Champ libelle="Devise par défaut">
                      <select className="champ" name="devise" defaultValue={imp.correspondance.devise ?? "XOF"}>
                        {r.devises.map((d) => <option key={d.code} value={d.code}>{d.code}</option>)}
                      </select>
                    </Champ>
                  </>
                )}
                {CHAMPS[imp.nature].map((c) => (
                  <Champ key={c.cle} libelle={c.libelle} obligatoire={c.obligatoire}>
                    <select className="champ" name={`col_${c.cle}`} defaultValue={corr[c.cle] === null || corr[c.cle] === undefined ? "" : String(corr[c.cle])}>
                      <option value="">— non repris —</option>
                      {entetes.map((e, i) => <option key={i} value={i}>{e}</option>)}
                    </select>
                  </Champ>
                ))}
              </div>
            </Formulaire>
          </Carte>
        )}

        <Carte titre="Données lues (10 premières lignes)" sousTitre="Valeurs telles qu'elles figurent dans le fichier, y compris les erreurs de formule" flush>
          <div className="tab-wrap">
            <table className="tab">
              <thead><tr><th>Ligne</th>{entetes.map((e, i) => <th key={i}>{e}</th>)}</tr></thead>
              <tbody>
                {imp.lignes.lignes.slice(0, 10).map((l, k) => (
                  <tr key={k}><td>{k + 2}</td>{entetes.map((_, i) => <td key={i} className="petit nowrap">{l[i] === null || l[i] === undefined ? "" : String(l[i])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </Carte>

        {rapport && (
          <>
            {rapport.erreurGlobale && <Message ton="erreur">{rapport.erreurGlobale}</Message>}
            <div className="grid-kpi">
              <Indicateur libelle="Lignes à importer" valeur={rapport.totaux.importer} icone="import" ton="bon" />
              <Indicateur libelle="Doublons ignorés" valeur={rapport.totaux.doublon} icone="validation" ton="gris" detail="Déjà importés ou répétés" />
              <Indicateur libelle="En quarantaine" valeur={rapport.totaux.quarantaine} icone="alerte" ton={rapport.totaux.quarantaine ? "alerte" : "bon"} detail="Non importées, conservées au registre" />
              <Indicateur libelle="Nouveaux instruments" valeur={rapport.nouveauxInstruments} icone="instruments" detail={`${rapport.nouvellesPositions} position(s)`} />
            </div>
            <Carte titre="2. Aperçu ligne par ligne" sousTitre="Aucune correction automatique : une ligne douteuse va en quarantaine avec son motif." flush
              action={enAnalyse && !rapport.erreurGlobale ? (
                <>
                  <BoutonAction action={lancerImport} champs={{ id }} libelle="Importer" classe="btn btn-mini" confirmation={`Importer ${rapport.totaux.importer} ligne(s) et placer ${rapport.totaux.quarantaine} ligne(s) en quarantaine ?`} />
                  <BoutonAction action={abandonnerImport} champs={{ id }} libelle="Abandonner" classe="btn-danger btn-mini" confirmation="Abandonner cet import ?" />
                </>
              ) : null}>
              {rapport.lignes.length === 0 ? <Vide>—</Vide> : (
                <div className="tab-wrap">
                  <table className="tab">
                    <thead><tr><th>Ligne</th><th>Résumé</th><th>Décision</th><th>Motif / remarques</th></tr></thead>
                    <tbody>
                      {rapport.lignes.slice(0, 1000).map((l) => (
                        <tr key={l.numero}>
                          <td>{l.numero}</td>
                          <td className="petit">{l.resume}</td>
                          <td><Badge ton={l.action === "importer" ? "bon" : l.action === "doublon" ? "gris" : "alerte"}>{l.action === "importer" ? "À importer" : l.action === "doublon" ? "Doublon" : "Quarantaine"}</Badge></td>
                          <td className="petit">{l.motif}{l.notes.length > 0 && <div className="mut">{l.notes.join(" · ")}</div>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Carte>
          </>
        )}
      </Contenu>
    </>
  );
}
