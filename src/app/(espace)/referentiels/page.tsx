/**
 * Référentiels : émetteurs, conservateurs, contreparties, portefeuilles, pays, devises,
 * types d'instruments, tranches de maturité, jours fériés (REF-02).
 */
import Link from "next/link";
import { BoutonAction, Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Badge, Carte, Champ, Message, Vide } from "@/composants/ui";
import { enregistrerReferentiel, supprimerReferentiel } from "@/app/actions/referentiels";
import { listesReferentiels, lireFeries, lireTranchesBrutes } from "@/donnees/referentiels";
import { exigerSession } from "@/lib/session";
import { dateFr } from "@/lib/format";

type Colonne = {
  nom: string;
  libelle: string;
  type?: "texte" | "entier" | "booleen" | "date" | "select";
  options?: { valeur: string; libelle: string }[];
  obligatoire?: boolean;
  cleFixe?: boolean; // non modifiable après création (codes)
  aide?: string;
};

const ONGLETS = [
  ["emetteurs", "Émetteurs"],
  ["conservateurs", "Conservateurs"],
  ["contreparties", "Contreparties et bénéficiaires"],
  ["portefeuilles", "Portefeuilles et entités"],
  ["pays", "Pays"],
  ["devises", "Devises"],
  ["types_instrument", "Types d'instruments"],
  ["tranches_maturite", "Tranches de maturité"],
  ["jours_feries", "Jours fériés"],
] as const;

function ChampsFormulaire({ colonnes, ligne }: { colonnes: Colonne[]; ligne?: Record<string, unknown> }) {
  return (
    <div className="form-grille trois">
      {colonnes.map((c) => {
        const v = ligne?.[c.nom];
        if (c.type === "booleen")
          return (
            <label className="case" key={c.nom} style={{ alignSelf: "end" }}>
              <input type="checkbox" name={c.nom} defaultChecked={ligne ? Boolean(v) : c.nom === "actif"} /> {c.libelle}
            </label>
          );
        if (c.type === "select")
          return (
            <Champ key={c.nom} libelle={c.libelle} obligatoire={c.obligatoire} aide={c.aide}>
              <select className="champ" name={c.nom} defaultValue={String(v ?? "")} required={c.obligatoire}>
                {!c.obligatoire && <option value="">—</option>}
                {c.options?.map((o) => (
                  <option key={o.valeur} value={o.valeur}>
                    {o.libelle}
                  </option>
                ))}
              </select>
            </Champ>
          );
        return (
          <Champ key={c.nom} libelle={c.libelle} obligatoire={c.obligatoire} aide={c.aide}>
            <input
              className="champ"
              name={c.nom}
              type={c.type === "date" ? "date" : c.type === "entier" ? "number" : "text"}
              defaultValue={v === null || v === undefined ? "" : String(v)}
              required={c.obligatoire}
              readOnly={Boolean(ligne && c.cleFixe)}
            />
          </Champ>
        );
      })}
    </div>
  );
}

function TableReferentiel({
  table,
  cle,
  colonnes,
  lignes,
  modifiable,
  affichage,
}: {
  table: string;
  cle: string;
  colonnes: Colonne[];
  lignes: Record<string, unknown>[];
  modifiable: boolean;
  affichage?: Record<string, (l: Record<string, unknown>) => React.ReactNode>;
}) {
  return (
    <>
      <Carte titre={`${lignes.length} élément(s)`} flush>
        {lignes.length === 0 ? (
          <Vide>Aucun élément pour l&apos;instant.</Vide>
        ) : (
          <div className="tab-wrap">
            <table className="tab">
              <thead>
                <tr>
                  {colonnes.map((c) => (
                    <th key={c.nom}>{c.libelle}</th>
                  ))}
                  {modifiable && <th className="noprint">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={String(l[cle])}>
                    {colonnes.map((c) => (
                      <td key={c.nom}>
                        {affichage?.[c.nom]
                          ? affichage[c.nom](l)
                          : c.type === "booleen"
                            ? l[c.nom] ? <Badge ton="bon">Oui</Badge> : <Badge ton="gris">Non</Badge>
                            : c.type === "date"
                              ? dateFr(String(l[c.nom]))
                              : c.type === "select"
                                ? (c.options?.find((o) => o.valeur === String(l[c.nom] ?? ""))?.libelle ?? "—")
                                : String(l[c.nom] ?? "—")}
                      </td>
                    ))}
                    {modifiable && (
                      <td className="noprint">
                        <details className="depliant">
                          <summary>Modifier</summary>
                          <div style={{ minWidth: 520, paddingTop: 10 }}>
                            <Formulaire action={enregistrerReferentiel}>
                              <input type="hidden" name="_table" value={table} />
                              <input type="hidden" name="_id" value={String(l[cle])} />
                              <ChampsFormulaire colonnes={colonnes} ligne={l} />
                            </Formulaire>
                            <div style={{ marginTop: 10 }}>
                              <BoutonAction
                                action={supprimerReferentiel}
                                champs={{ table, id: String(l[cle]) }}
                                libelle="Supprimer"
                                classe="btn-danger btn-mini"
                                confirmation="Supprimer cet élément ? Impossible s'il est encore utilisé."
                              />
                            </div>
                          </div>
                        </details>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Carte>
      {modifiable && (
        <Carte titre="Ajouter">
          <Formulaire action={enregistrerReferentiel} bouton="Ajouter" reinitialiser>
            <input type="hidden" name="_table" value={table} />
            <ChampsFormulaire colonnes={colonnes} />
          </Formulaire>
        </Carte>
      )}
    </>
  );
}

export default async function Referentiels(props: PageProps<"/referentiels">) {
  const s = await exigerSession();
  const q = await props.searchParams;
  const onglet = (typeof q.onglet === "string" ? q.onglet : "emetteurs") as (typeof ONGLETS)[number][0];
  const [r, tranches, feries] = await Promise.all([listesReferentiels(), lireTranchesBrutes(), lireFeries()]);
  const modifiable = s.peut("gerer_referentiels");
  const optPays = r.pays.map((p) => ({ valeur: p.code, libelle: `${p.nom} (${p.code})` }));

  let corps: React.ReactNode = null;
  switch (onglet) {
    case "emetteurs":
      corps = (
        <TableReferentiel table="emetteurs" cle="id" modifiable={modifiable} lignes={r.emetteurs}
          colonnes={[{ nom: "nom", libelle: "Nom", obligatoire: true }, { nom: "pays_code", libelle: "Pays", type: "select", options: optPays }, { nom: "secteur", libelle: "Secteur" }, { nom: "actif", libelle: "Actif", type: "booleen" }]} />
      );
      break;
    case "conservateurs":
      corps = (
        <TableReferentiel table="conservateurs" cle="id" modifiable={modifiable} lignes={r.conservateurs}
          colonnes={[{ nom: "nom", libelle: "Nom", obligatoire: true }, { nom: "code", libelle: "Code" }, { nom: "actif", libelle: "Actif", type: "booleen" }]} />
      );
      break;
    case "contreparties":
      corps = (
        <TableReferentiel table="contreparties" cle="id" modifiable={modifiable} lignes={r.contreparties}
          colonnes={[{ nom: "nom", libelle: "Nom", obligatoire: true }, { nom: "role", libelle: "Rôle", type: "select", obligatoire: true, options: [{ valeur: "les_deux", libelle: "Contrepartie et bénéficiaire" }, { valeur: "contrepartie", libelle: "Contrepartie de marché" }, { valeur: "beneficiaire", libelle: "Bénéficiaire de grevage" }] }, { nom: "actif", libelle: "Actif", type: "booleen" }]} />
      );
      break;
    case "portefeuilles":
      corps = (
        <>
          <TableReferentiel table="portefeuilles" cle="id" modifiable={modifiable} lignes={r.portefeuilles}
            colonnes={[{ nom: "code", libelle: "Code", obligatoire: true }, { nom: "libelle", libelle: "Libellé", obligatoire: true }, { nom: "entite_id", libelle: "Entité", type: "select", options: r.entites.map((e) => ({ valeur: e.id, libelle: e.nom })) }, { nom: "actif", libelle: "Actif", type: "booleen" }]} />
          <h2 className="zone">Entités</h2>
          <TableReferentiel table="entites" cle="id" modifiable={modifiable} lignes={r.entites} colonnes={[{ nom: "nom", libelle: "Nom", obligatoire: true }]} />
        </>
      );
      break;
    case "pays":
      corps = (
        <TableReferentiel table="pays" cle="code" modifiable={modifiable} lignes={r.pays}
          colonnes={[{ nom: "code", libelle: "Code ISO", obligatoire: true, cleFixe: true, aide: "2 lettres (BF, CI…)" }, { nom: "nom", libelle: "Nom", obligatoire: true }, { nom: "zone", libelle: "Zone" }]} />
      );
      break;
    case "devises":
      corps = (
        <TableReferentiel table="devises" cle="code" modifiable={modifiable} lignes={r.devises}
          colonnes={[{ nom: "code", libelle: "Code ISO", obligatoire: true, cleFixe: true, aide: "3 lettres (XOF, EUR…)" }, { nom: "libelle", libelle: "Libellé", obligatoire: true }, { nom: "decimales", libelle: "Décimales", type: "entier" }]} />
      );
      break;
    case "types_instrument":
      corps = (
        <TableReferentiel table="types_instrument" cle="code" modifiable={modifiable} lignes={r.types}
          colonnes={[{ nom: "code", libelle: "Code", obligatoire: true, cleFixe: true }, { nom: "libelle", libelle: "Libellé", obligatoire: true }, { nom: "precompte", libelle: "Intérêts précomptés", type: "booleen" }]} />
      );
      break;
    case "tranches_maturite":
      corps = (
        <>
          <Message ton="info">Bornes en jours restants jusqu&apos;à l&apos;échéance : borne basse incluse, borne haute exclue (vide = sans limite). Les titres échus forment toujours la tranche « Échu ».</Message>
          <TableReferentiel table="tranches_maturite" cle="id" modifiable={modifiable} lignes={tranches}
            colonnes={[{ nom: "libelle", libelle: "Libellé", obligatoire: true }, { nom: "borne_min", libelle: "De (jours)", type: "entier", obligatoire: true }, { nom: "borne_max", libelle: "À (jours, exclu)", type: "entier" }, { nom: "ordre", libelle: "Ordre", type: "entier" }]} />
        </>
      );
      break;
    case "jours_feries":
      corps = (
        <>
          <Message ton="info">Les dates de règlement prévues sont reportées au jour ouvré suivant (week-ends et jours fériés ci-dessous). Ajouter un jour férié recalcule les échéances.</Message>
          <TableReferentiel table="jours_feries" cle="date" modifiable={modifiable} lignes={feries}
            colonnes={[{ nom: "date", libelle: "Date", type: "date", obligatoire: true, cleFixe: true }, { nom: "libelle", libelle: "Libellé" }]} />
        </>
      );
      break;
  }

  return (
    <>
      <EnTete titre="Référentiels" sousTitre="Données de référence partagées par tous les écrans" />
      <Contenu>
        <nav className="stknav">
          {ONGLETS.map(([k, l]) => (
            <Link key={k} href={`/referentiels?onglet=${k}`} className={k === onglet ? "on" : ""}>
              {l}
            </Link>
          ))}
        </nav>
        {!modifiable && <Message ton="info">Consultation seule : les référentiels sont administrés par un administrateur.</Message>}
        {corps}
      </Contenu>
    </>
  );
}
