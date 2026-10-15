/**
 * Alertes et anomalies (§9) : contrôles calculés, lignes d'import en quarantaine, suivi de traitement.
 */
import Link from "next/link";
import { BoutonAction, Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Badge, Carte, Champ, EnTeteImpression, Indicateur, Vide, type Ton } from "@/composants/ui";
import { suivreControle, traiterQuarantaine } from "@/app/actions/controles";
import { analyser } from "@/donnees/portefeuille";
import { lire } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { dateFr, dateHeureFr } from "@/lib/format";
import { FAMILLES_CONTROLE, LIBELLES_NIVEAU, type Niveau } from "@/moteur";

const TON: Record<Niveau, Ton> = { bloquant: "erreur", erreur: "erreur", alerte: "alerte", info: "info" };
const SUIVI: Record<string, [string, Ton]> = { nouveau: ["Nouveau", "gris"], en_cours: ["En cours", "alerte"], traite: ["Traité", "bon"], accepte: ["Accepté", "info"] };

export default async function Controles(props: PageProps<"/controles">) {
  const s = await exigerSession();
  const q = await props.searchParams;
  const val = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const [a, suivis, utilisateurs, quarantaine] = await Promise.all([
    analyser(s, null),
    lire<{ cle: string; statut: string; responsable_id: string | null; responsable: string | null; commentaire: string; modifie_le: string }>(
      "select s.cle, s.statut, s.responsable_id, u.nom as responsable, s.commentaire, s.modifie_le from suivi_controles s left join utilisateurs u on u.id = s.responsable_id",
    ),
    lire<{ id: string; nom: string }>("select id, nom from utilisateurs where actif order by nom"),
    lire<{ id: string; numero_ligne: number; motif: string; donnees: Record<string, unknown>; statut: string; commentaire: string; nom_fichier: string; cree_le: string; traite_par: string | null }>(
      `select q.id, q.numero_ligne, q.motif, q.donnees, q.statut, q.commentaire, i.nom_fichier, i.cree_le, u.nom as traite_par
         from quarantaine q join imports i on i.id = q.import_id left join utilisateurs u on u.id = q.traite_par
        order by (q.statut = 'ouverte') desc, i.cree_le desc, q.numero_ligne limit 300`,
    ),
  ]);
  const parCle = new Map(suivis.map((x) => [x.cle, x]));
  const masquerTraites = val("tout") !== "1";
  const famille = val("famille");
  const niveau = val("niveau");
  const controles = a.controles
    .filter((c) => !famille || c.famille === famille)
    .filter((c) => !niveau || c.niveau === niveau)
    .filter((c) => !masquerTraites || !["traite", "accepte"].includes(parCle.get(c.cle)?.statut ?? ""));
  const compte = (n: Niveau) => a.controles.filter((c) => c.niveau === n && !["traite", "accepte"].includes(parCle.get(c.cle)?.statut ?? "")).length;
  const qOuvertes = quarantaine.filter((x) => x.statut === "ouverte");
  const peutTraiter = s.peut("traiter_controles");

  return (
    <>
      <EnTete titre="Alertes et anomalies" sousTitre={`Contrôles automatiques au ${dateFr(a.aujourdhui)} · seuils d'échéance J-${a.parametres.seuilsAlerte.join(", J-")} · tolérance ${a.parametres.toleranceEncaissement} j`} />
      <Contenu>
        <EnTeteImpression titre={`Rapport d'anomalies au ${dateFr(a.aujourdhui)}`} sousTitre={a.parametres.nomEtablissement} />
        <div className="grid-kpi">
          <Indicateur libelle="Bloquants" valeur={compte("bloquant")} icone="alerte" ton={compte("bloquant") ? "erreur" : "bon"} detail="À corriger avant toute validation" />
          <Indicateur libelle="Erreurs" valeur={compte("erreur")} icone="controles" ton={compte("erreur") ? "erreur" : "bon"} detail="Retards, titres échus, calculs impossibles" />
          <Indicateur libelle="Alertes" valeur={compte("alerte")} icone="horloge" ton="alerte" detail="Échéances proches, écarts, concentration" />
          <Indicateur libelle="Lignes en quarantaine" valeur={qOuvertes.length} icone="import" ton={qOuvertes.length ? "alerte" : "bon"} detail="Anomalies héritées des imports" />
        </div>
        <form className="barre-filtres noprint" method="get">
          <select className="champ" name="famille" defaultValue={famille}>
            <option value="">Toutes les familles</option>
            {Object.values(FAMILLES_CONTROLE).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select className="champ" name="niveau" defaultValue={niveau}>
            <option value="">Tous les niveaux</option>
            {Object.entries(LIBELLES_NIVEAU).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <label className="case"><input type="checkbox" name="tout" value="1" defaultChecked={!masquerTraites} /> Afficher aussi les points traités / acceptés</label>
          <button className="btn-sec">Filtrer</button>
          {(famille || niveau || !masquerTraites) && <Link className="btn-sec" href="/controles">Réinitialiser</Link>}
        </form>
        <Carte titre={`${controles.length} point(s)`} sousTitre="Chaque point a un responsable et un statut de traitement ; il disparaît de lui-même quand la cause est corrigée." flush>
          {controles.length === 0 ? <Vide>✔ Aucun point ouvert.</Vide> : (
            <div className="tab-wrap">
              <table className="tab">
                <thead><tr><th>Niveau</th><th>Contrôle</th><th>Objet</th><th>Détail</th><th>Suivi</th>{peutTraiter && <th className="noprint">Traiter</th>}</tr></thead>
                <tbody>
                  {controles.map((c) => {
                    const sv = parCle.get(c.cle);
                    const [lib, ton] = SUIVI[sv?.statut ?? "nouveau"];
                    return (
                      <tr key={c.cle}>
                        <td><Badge ton={TON[c.niveau]}>{LIBELLES_NIVEAU[c.niveau]}</Badge></td>
                        <td className="petit"><b>{c.famille}</b></td>
                        <td><Link href={c.lien}>{c.libelle}</Link></td>
                        <td className="petit">{c.detail}</td>
                        <td className="petit"><Badge ton={ton}>{lib}</Badge>{sv?.responsable && <div>{sv.responsable}</div>}{sv?.commentaire && <div className="mut">{sv.commentaire}</div>}</td>
                        {peutTraiter && (
                          <td className="noprint">
                            <details className="depliant">
                              <summary>Suivre</summary>
                              <div style={{ minWidth: 300, paddingTop: 8 }}>
                                <Formulaire action={suivreControle} bouton="Enregistrer">
                                  <input type="hidden" name="cle" value={c.cle} />
                                  <Champ libelle="Statut"><select className="champ" name="statut" defaultValue={sv?.statut ?? "en_cours"}>{Object.entries(SUIVI).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Champ>
                                  <div style={{ marginTop: 8 }}><Champ libelle="Responsable"><select className="champ" name="responsable_id" defaultValue={sv?.responsable_id ?? s.u.id}><option value="">—</option>{utilisateurs.map((u) => <option key={u.id} value={u.id}>{u.nom}</option>)}</select></Champ></div>
                                  <div style={{ marginTop: 8 }}><Champ libelle="Commentaire"><input className="champ" name="commentaire" defaultValue={sv?.commentaire ?? ""} /></Champ></div>
                                </Formulaire>
                              </div>
                            </details>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Carte>

        <Carte titre="Quarantaine des imports" sousTitre="Lignes du classeur non importées (divergences, codes invalides, disponibles négatifs…) : jamais corrigées automatiquement, jamais effacées" flush>
          {quarantaine.length === 0 ? <Vide>Aucune ligne en quarantaine.</Vide> : (
            <div className="tab-wrap">
              <table className="tab">
                <thead><tr><th>Fichier · ligne</th><th>Motif</th><th>Données</th><th>Statut</th>{peutTraiter && <th className="noprint"></th>}</tr></thead>
                <tbody>
                  {quarantaine.map((x) => (
                    <tr key={x.id}>
                      <td className="petit">{x.nom_fichier}<div className="mut">ligne {x.numero_ligne} · {dateHeureFr(x.cree_le)}</div></td>
                      <td className="petit">{x.motif}</td>
                      <td className="petit" style={{ maxWidth: 380 }}>{Object.entries(x.donnees).slice(0, 8).map(([k, v]) => <span key={k}><b>{k}</b> : {String(v ?? "")} · </span>)}</td>
                      <td className="petit"><Badge ton={x.statut === "ouverte" ? "alerte" : x.statut === "corrigee" ? "bon" : "gris"}>{x.statut === "ouverte" ? "Ouverte" : x.statut === "corrigee" ? "Corrigée" : "Rejetée"}</Badge>{x.commentaire && <div className="mut">{x.commentaire} {x.traite_par && `(${x.traite_par})`}</div>}</td>
                      {peutTraiter && (
                        <td className="noprint">
                          {x.statut === "ouverte" ? (
                            <div className="actions">
                              <BoutonAction action={traiterQuarantaine} champs={{ id: x.id, statut: "corrigee" }} libelle="Corrigée" motif="Comment la ligne a-t-elle été corrigée (saisie manuelle, nouvel import…) ?" />
                              <BoutonAction action={traiterQuarantaine} champs={{ id: x.id, statut: "rejetee" }} libelle="Rejeter" classe="btn-danger btn-mini" motif="Motif du rejet :" />
                            </div>
                          ) : (
                            <BoutonAction action={traiterQuarantaine} champs={{ id: x.id, statut: "ouverte" }} libelle="Rouvrir" />
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
