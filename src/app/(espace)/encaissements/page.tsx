/**
 * Encaissements : échéances attendues, reçues, partielles, en retard, en litige ; saisie et rapprochement.
 */
import Link from "next/link";
import { BoutonAction, Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { StatutEcheanceBadge } from "@/composants/Statuts";
import { Carte, Champ, Indicateur, Message, Vide } from "@/composants/ui";
import { annulerEncaissement, enregistrerEncaissement, qualifierEcheance } from "@/app/actions/encaissements";
import { analyser } from "@/donnees/portefeuille";
import { lire } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { compact, dateFr, dateHeureFr, montant } from "@/lib/format";
import { ajouterJours, joursEntre, type EcheanceSuivie } from "@/moteur";

const VUES = {
  a_traiter: "À traiter",
  a_venir: "À venir (90 jours)",
  encaissees: "Encaissées",
  toutes: "Toutes",
} as const;

export default async function Encaissements(props: PageProps<"/encaissements">) {
  const s = await exigerSession();
  const q = await props.searchParams;
  const val = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const vue = (val("vue") || "a_traiter") as keyof typeof VUES;
  const a = await analyser(s, null);
  const jour = a.aujourdhui;
  const filtres: Record<keyof typeof VUES, (e: EcheanceSuivie) => boolean> = {
    a_traiter: (e) => ["a_encaisser", "en_retard", "partielle", "litige"].includes(e.statut),
    a_venir: (e) => e.statut === "prevue" && e.dateReglementPrevue <= ajouterJours(jour, 90),
    encaissees: (e) => e.statut === "encaissee",
    toutes: () => true,
  };
  const texte = val("q").toLowerCase();
  const lignes = a.situation.echeances
    .filter((e) => e.ligne)
    .filter(filtres[vue] ?? filtres.a_traiter)
    .filter((e) => !texte || `${e.ligne?.instrument.code} ${e.ligne?.instrument.libelle} ${e.ligne?.position.conservateur}`.toLowerCase().includes(texte))
    .sort((x, y) => (vue === "encaissees" ? y.dateReglementPrevue.localeCompare(x.dateReglementPrevue) : x.dateReglementPrevue.localeCompare(y.dateReglementPrevue)));
  const selection = val("echeance") ? a.situation.echeances.find((e) => e.id === val("echeance")) : undefined;
  const encaissements = selection
    ? await lire<{ id: string; date_valeur: string; montant: number; nature: string; reference: string; commentaire: string; statut: string; motif_annulation: string | null; saisi_par: string | null; saisi_le: string }>(
        "select x.*, u.nom as saisi_par from encaissements x left join utilisateurs u on u.id = x.saisi_par where echeance_id = $1 order by date_valeur",
        [selection.id],
      )
    : [];
  const retard = a.situation.echeances.filter((e) => e.statut === "en_retard" || e.statut === "partielle");
  const litiges = a.situation.echeances.filter((e) => e.statut === "litige");
  const aEncaisser = a.situation.echeances.filter((e) => e.statut === "a_encaisser");
  const monoDevise = new Set(a.situation.echeances.map((e) => e.ligne?.instrument.devise)).size <= 1;

  return (
    <>
      <EnTete titre="Encaissements" sousTitre={`Flux prévus et flux réellement reçus · tolérance de ${a.parametres.toleranceEncaissement} jour(s) avant retard`} />
      <Contenu>
        <div className="grid-kpi">
          <Indicateur libelle="À encaisser (dans la tolérance)" valeur={aEncaisser.length} icone="horloge" ton="alerte" detail={monoDevise ? `${compact(aEncaisser.reduce((t, e) => t + e.reste, 0))} attendus` : "Plusieurs devises"} />
          <Indicateur libelle="En retard ou partielles" valeur={retard.length} icone="alerte" ton={retard.length ? "erreur" : "bon"} detail={monoDevise ? `${compact(retard.reduce((t, e) => t + e.reste, 0))} restant dus` : "Plusieurs devises"} />
          <Indicateur libelle="En litige" valeur={litiges.length} icone="controles" ton={litiges.length ? "erreur" : "bon"} detail={monoDevise ? `${compact(litiges.reduce((t, e) => t + e.reste, 0))} en jeu` : "Plusieurs devises"} />
          <Indicateur libelle="Encaissées (toutes dates)" valeur={a.situation.echeances.filter((e) => e.statut === "encaissee").length} icone="coche" ton="bon" detail="Échéances soldées" />
        </div>

        {selection && selection.ligne && (
          <Carte
            titre={`Échéance du ${dateFr(selection.dateContractuelle)} — ${selection.ligne.instrument.code} · ${selection.ligne.position.conservateur}`}
            sousTitre={`Règlement prévu le ${dateFr(selection.dateReglementPrevue)} · ${selection.ligne.instrument.devise}`}
            action={<Link className="btn-sec btn-mini" href={`/encaissements?vue=${vue}`}>Fermer</Link>}
          >
            <div className="rangee deux" style={{ marginBottom: 0 }}>
              <div>
                <dl className="liste-def">
                  <dt>Capital dû</dt><dd>{montant(selection.capitalDu, 2)}</dd>
                  <dt>Intérêts bruts</dt><dd>{montant(selection.interetBrut, 2)}</dd>
                  <dt>Retenue</dt><dd>{montant(selection.retenue, 2)}</dd>
                  <dt>Net attendu</dt><dd><b>{montant(selection.netAttendu, 2)}</b></dd>
                  <dt>Reçu</dt><dd>{montant(selection.montantRecu, 2)}</dd>
                  <dt>Reste dû</dt><dd className={selection.reste > 0.01 ? "neg" : ""}>{montant(selection.reste, 2)}</dd>
                  <dt>Statut</dt><dd><StatutEcheanceBadge s={selection.statut} /></dd>
                  <dt>Explication d&apos;écart</dt><dd>{selection.explicationEcart ?? "—"}</dd>
                </dl>
                <h4 style={{ margin: "18px 0 8px", fontSize: 13 }}>Encaissements rapprochés</h4>
                {encaissements.length === 0 ? <p className="petit mut">Aucun encaissement.</p> : (
                  <table className="tab" style={{ margin: "0 -20px", width: "calc(100% + 40px)" }}>
                    <thead><tr><th>Date de valeur</th><th className="d">Montant</th><th>Référence</th><th></th></tr></thead>
                    <tbody>
                      {encaissements.map((x) => (
                        <tr key={x.id} className={x.statut === "annule" ? "annule" : ""}>
                          <td className="nowrap">{dateFr(x.date_valeur)}<div className="petit mut">{x.saisi_par}, {dateHeureFr(x.saisi_le)}</div></td>
                          <td className="d">{montant(x.montant, 2)}</td>
                          <td className="petit">{x.reference || "—"}{x.motif_annulation && <div>Annulé : {x.motif_annulation}</div>}</td>
                          <td>{x.statut === "actif" && s.peut("encaisser") && <BoutonAction action={annulerEncaissement} champs={{ id: x.id }} libelle="Annuler" classe="btn-danger btn-mini" motif="Motif de l'annulation :" />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {s.peut("encaisser") && (
                <div>
                  <Formulaire action={enregistrerEncaissement} bouton="Enregistrer l'encaissement" reinitialiser>
                    <input type="hidden" name="echeance_id" value={selection.id} />
                    <div className="form-grille">
                      <Champ libelle="Date de valeur" obligatoire><input className="champ" type="date" name="date_valeur" defaultValue={selection.dateReglementPrevue <= jour ? selection.dateReglementPrevue : jour} required /></Champ>
                      <Champ libelle="Montant reçu" obligatoire><input className="champ" name="montant" inputMode="decimal" defaultValue={selection.reste > 0 ? selection.reste : ""} required /></Champ>
                      <Champ libelle="Nature">
                        <select className="champ" name="nature" defaultValue={selection.capitalDu > 0 ? "mixte" : "interet"}><option value="mixte">Capital et intérêts</option><option value="interet">Intérêts</option><option value="capital">Capital</option></select>
                      </Champ>
                      <Champ libelle="Référence (avis de crédit…)"><input className="champ" name="reference" /></Champ>
                      <Champ libelle="Commentaire" className="plein"><input className="champ" name="commentaire" /></Champ>
                    </div>
                    {selection.capitalDu > 0 && (
                      <label className="case" style={{ marginTop: 8 }}><input type="checkbox" name="constater_capital" value="1" defaultChecked /> Proposer l&apos;opération d&apos;amortissement de {montant(selection.capitalDu)} (à valider)</label>
                    )}
                  </Formulaire>
                  <details className="depliant" style={{ marginTop: 18 }}>
                    <summary>Litige, annulation ou explication d&apos;écart</summary>
                    <Formulaire action={qualifierEcheance} bouton="Enregistrer">
                      <input type="hidden" name="id" value={selection.id} />
                      <div className="form-grille">
                        <Champ libelle="Statut manuel">
                          <select className="champ" name="statut_manuel" defaultValue={selection.statutManuel === "litige" || selection.statutManuel === "annulee" ? selection.statutManuel : ""}>
                            <option value="">Aucun (statut calculé)</option><option value="litige">En litige</option><option value="annulee">Annulée</option>
                          </select>
                        </Champ>
                        <Champ libelle="Motif"><input className="champ" name="motif" /></Champ>
                        <Champ libelle="Explication de l'écart" className="plein"><textarea className="champ" name="explication_ecart" defaultValue={selection.explicationEcart ?? ""} rows={2} /></Champ>
                      </div>
                    </Formulaire>
                  </details>
                </div>
              )}
            </div>
          </Carte>
        )}
        {val("echeance") && !selection && <Message ton="alerte">Échéance introuvable ou hors de votre périmètre.</Message>}

        <nav className="stknav noprint">
          {Object.entries(VUES).map(([k, l]) => (
            <Link key={k} href={`/encaissements?vue=${k}`} className={k === vue ? "on" : ""}>{l}</Link>
          ))}
        </nav>
        <form className="barre-filtres noprint" method="get">
          <input type="hidden" name="vue" value={vue} />
          <input className="champ" name="q" defaultValue={val("q")} placeholder="Code, libellé, conservateur…" />
          <button className="btn-sec">Filtrer</button>
          {val("q") && <Link className="btn-sec" href={`/encaissements?vue=${vue}`}>Réinitialiser</Link>}
        </form>
        <Carte titre={`${lignes.length} échéance(s) — ${VUES[vue]}`} flush>
          {lignes.length === 0 ? <Vide>Rien à afficher.</Vide> : (
            <div className="tab-wrap">
              <table className="tab">
                <thead><tr><th>Règlement prévu</th><th>Instrument</th><th>Conservateur</th><th className="d">Net attendu</th><th className="d">Reçu</th><th className="d">Reste dû</th><th>Retard</th><th>Statut</th></tr></thead>
                <tbody>
                  {lignes.slice(0, 400).map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap"><Link href={`/encaissements?vue=${vue}&echeance=${e.id}`}>{dateFr(e.dateReglementPrevue)}</Link></td>
                      <td><Link href={`/positions/${e.positionId}`}>{e.ligne?.instrument.code}</Link><div className="petit mut">{e.ligne?.instrument.libelle}</div></td>
                      <td>{e.ligne?.position.conservateur}</td>
                      <td className="d">{montant(e.netAttendu)} <span className="petit mut">{e.ligne?.instrument.devise}</span></td>
                      <td className="d">{montant(e.montantRecu)}</td>
                      <td className={`d ${e.reste > 0.01 && e.dateReglementPrevue < jour ? "neg" : ""}`}>{montant(e.reste)}</td>
                      <td className="petit">{e.dateReglementPrevue < jour && e.reste > 0.01 ? `${joursEntre(e.dateReglementPrevue, jour)} j` : "—"}</td>
                      <td><StatutEcheanceBadge s={e.statut} /></td>
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
