/**
 * Fiche grevage : détail, validation, augmentation / réduction, mainlevée, mouvements, pièces.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { BoutonAction, Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Historique } from "@/composants/Historique";
import { Pieces } from "@/composants/Pieces";
import { StatutGrevage } from "@/composants/Statuts";
import { Carte, Champ, Message, Vide } from "@/composants/ui";
import { changerStatutGrevage, modifierNominalGrevage } from "@/app/actions/grevages";
import { lire, lireUn } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { dateFr, dateHeureFr, montant, pourcent } from "@/lib/format";

export default async function FicheGrevage(props: PageProps<"/grevages/[id]">) {
  const s = await exigerSession();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const g = await lireUn<{
    id: string; statut: string; nominal_affecte: number; decote_pct: number | null; valeur_retenue: number | null; financement_obtenu: number | null;
    date_debut: string; date_fin: string | null; reference_convention: string; commentaire: string; beneficiaire: string; code: string; libelle: string;
    conservateur: string; devise: string; position_id: string; date_echeance: string | null; initiateur_id: string; initiateur: string | null;
    validateur: string | null; valide_le: string | null; motif_rejet: string | null; leve_par_nom: string | null; leve_le: string | null; motif_levee: string | null;
    nominal_detenu: number; greve_autres: number; portefeuille_id: string;
  }>(
    `select g.*, b.nom as beneficiaire, i.code_interne as code, i.libelle, c.nom as conservateur, i.devise_code as devise, i.date_echeance,
            ui.nom as initiateur, uv.nom as validateur, ul.nom as leve_par_nom, p.nominal_actuel as nominal_detenu,
            nominal_greve_actif(p.id, g.id) as greve_autres, p.portefeuille_id
       from grevages g join contreparties b on b.id = g.beneficiaire_id join positions p on p.id = g.position_id
       join instruments i on i.id = p.instrument_id join conservateurs c on c.id = p.conservateur_id
       left join utilisateurs ui on ui.id = g.initiateur_id left join utilisateurs uv on uv.id = g.validateur_id
       left join utilisateurs ul on ul.id = g.leve_par where g.id = $1`,
    [id],
  );
  if (!g || (s.u.portefeuilles.length && !s.u.portefeuilles.includes(g.portefeuille_id))) notFound();
  const mouvements = await lire<{ id: number; type: string; nominal_avant: number; nominal_apres: number; date: string; motif: string; auteur: string | null }>(
    "select m.id, m.type, m.nominal_avant, m.nominal_apres, m.date, m.motif, u.nom as auteur from mouvements_grevage m left join utilisateurs u on u.id = m.auteur_id where grevage_id = $1 order by m.id",
    [id],
  );
  const disponible = g.nominal_detenu - g.greve_autres;
  const estInitiateur = g.initiateur_id === s.u.id;
  return (
    <>
      <EnTete titre={`Grevage — ${g.beneficiaire}`} sousTitre={<>{g.code} · {g.conservateur} · <StatutGrevage s={g.statut} /></>} />
      <Contenu>
        <p className="petit noprint"><Link href="/grevages">← Tous les grevages</Link> · <Link href={`/positions/${g.position_id}`}>Position</Link></p>
        {g.statut === "soumis" && g.nominal_affecte > disponible + 0.005 && (
          <Message ton="erreur">Contrôle bloquant : le nominal affecté ({montant(g.nominal_affecte)}) dépasse le disponible ({montant(disponible)}). La validation sera refusée.</Message>
        )}
        {g.statut === "rejete" && <Message ton="erreur">Rejeté par {g.validateur} : {g.motif_rejet}</Message>}
        <div className="rangee deux">
          <Carte titre="Affectation">
            <dl className="liste-def">
              <dt>Instrument</dt><dd>{g.code} — {g.libelle} (échéance {dateFr(g.date_echeance)})</dd>
              <dt>Nominal affecté</dt><dd><b>{montant(g.nominal_affecte, 2)} {g.devise}</b></dd>
              <dt>Décote</dt><dd>{g.decote_pct === null ? "—" : pourcent(g.decote_pct)}</dd>
              <dt>Valeur retenue en garantie</dt><dd>{montant(g.valeur_retenue, 2)}</dd>
              <dt>Financement obtenu</dt><dd>{montant(g.financement_obtenu, 2)} <span className="petit mut">(mesure distincte, non soustraite)</span></dd>
              <dt>Période</dt><dd>{dateFr(g.date_debut)} → {g.date_fin ? dateFr(g.date_fin) : "sans date de fin"}</dd>
              <dt>Convention</dt><dd>{g.reference_convention || "—"}</dd>
              <dt>Nominal détenu · autres grevages</dt><dd>{montant(g.nominal_detenu)} · {montant(g.greve_autres)}</dd>
              <dt>Disponible pour ce grevage</dt><dd className={disponible < g.nominal_affecte ? "neg" : "pos"}>{montant(disponible)}</dd>
              <dt>Initiateur</dt><dd>{g.initiateur ?? "—"}</dd>
              <dt>Validation</dt><dd>{g.validateur ? `${g.validateur}, ${dateHeureFr(g.valide_le)}` : "—"}</dd>
              <dt>Mainlevée</dt><dd>{g.leve_par_nom ? `${g.leve_par_nom}, ${dateHeureFr(g.leve_le)} — ${g.motif_levee}` : "—"}</dd>
            </dl>
            <div className="actions noprint" style={{ marginTop: 16 }}>
              {g.statut === "brouillon" && s.peut("grever") && <BoutonAction action={changerStatutGrevage} champs={{ id, statut: "soumis" }} libelle="Soumettre" classe="btn btn-mini" />}
              {g.statut === "soumis" && s.peut("valider") && !estInitiateur && (
                <>
                  <BoutonAction action={changerStatutGrevage} champs={{ id, statut: "actif" }} libelle="Valider" classe="btn btn-mini" confirmation="Valider ce grevage ? Le disponible sera contrôlé." />
                  <BoutonAction action={changerStatutGrevage} champs={{ id, statut: "rejete" }} libelle="Rejeter" classe="btn-danger btn-mini" motif="Motif du rejet :" />
                </>
              )}
              {g.statut === "soumis" && estInitiateur && <span className="petit mut">Validation par une autre personne que vous.</span>}
              {g.statut === "actif" && s.peut("lever_grevage") && (
                <BoutonAction action={changerStatutGrevage} champs={{ id, statut: "leve" }} libelle="Mainlevée" classe="btn-danger btn-mini" motif="Motif de la mainlevée (date du jour) :" />
              )}
            </div>
          </Carte>
          <Carte titre="Mouvements" sousTitre="Création, augmentations, réductions, mainlevée" flush>
            {mouvements.length === 0 ? <Vide>Aucun mouvement.</Vide> : (
              <table className="tab">
                <thead><tr><th>Date</th><th>Mouvement</th><th className="d">Avant</th><th className="d">Après</th><th>Auteur · motif</th></tr></thead>
                <tbody>
                  {mouvements.map((m) => (
                    <tr key={m.id}>
                      <td className="nowrap">{dateFr(m.date)}</td>
                      <td>{{ creation: "Création", augmentation: "Augmentation", reduction: "Réduction", mainlevee: "Mainlevée" }[m.type]}</td>
                      <td className="d">{montant(m.nominal_avant)}</td>
                      <td className="d">{montant(m.nominal_apres)}</td>
                      <td className="petit">{m.auteur ?? "—"}{m.motif && <div className="mut">{m.motif}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {g.statut === "actif" && (s.peut("valider") || s.peut("lever_grevage")) && (
              <div style={{ padding: "12px 20px 20px" }}>
                <details className="depliant">
                  <summary>Augmenter ou réduire</summary>
                  <Formulaire action={modifierNominalGrevage} bouton="Enregistrer">
                    <input type="hidden" name="id" value={id} />
                    <div className="form-grille">
                      <Champ libelle="Nouveau nominal affecté" obligatoire><input className="champ" name="nominal_affecte" inputMode="decimal" defaultValue={g.nominal_affecte} required /></Champ>
                      <Champ libelle="Date du mouvement"><input className="champ" type="date" name="date" /></Champ>
                      <Champ libelle="Motif" obligatoire className="plein"><input className="champ" name="motif" required /></Champ>
                    </div>
                  </Formulaire>
                </details>
              </div>
            )}
          </Carte>
        </div>
        <Pieces objet="grevage" id={id} />
        <Historique table="grevages" id={id} />
      </Contenu>
    </>
  );
}
