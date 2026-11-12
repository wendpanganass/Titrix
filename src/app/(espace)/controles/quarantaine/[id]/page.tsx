/**
 * Correction d'une ligne en quarantaine : les valeurs du fichier d'origine sont modifiables, puis la ligne
 * est intégrée par un mini-import (mêmes contrôles que l'import d'origine, tracé dans l'historique des imports).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Badge, Carte, Champ, Message } from "@/composants/ui";
import { integrerLigneQuarantaine } from "@/app/actions/imports";
import type { ImportEnBase } from "@/donnees/imports";
import { lireUn } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { dateFr, dateHeureFr } from "@/lib/format";
import { CHAMPS, estErreurFormule } from "@/lib/import-regles";

// L'intégration rejoue l'analyse et l'exécution d'un import : délai allongé sur Vercel.
export const maxDuration = 60;

export default async function CorrigerQuarantaine(props: PageProps<"/controles/quarantaine/[id]">) {
  const s = await exigerSession();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const q = await lireUn<{ id: string; numero_ligne: number; motif: string; statut: string; commentaire: string; import_id: string; traite_par: string | null; traite_le: string | null }>(
    "select q.id, q.numero_ligne, q.motif, q.statut, q.commentaire, q.import_id, u.nom as traite_par, q.traite_le from quarantaine q left join utilisateurs u on u.id = q.traite_par where q.id = $1",
    [id],
  );
  if (!q) notFound();
  const imp = await lireUn<ImportEnBase & { cree_le: string }>("select id, nom_fichier, nature, correspondance, lignes, statut, cree_le from imports where id = $1", [q.import_id]);
  if (!imp) notFound();
  const valeurs = imp.lignes.lignes[q.numero_ligne - 2] ?? [];
  const texte = (i: number) => (valeurs[i] === null || valeurs[i] === undefined ? "" : String(valeurs[i]));
  // Colonnes reprises (dans l'ordre des champs Titrix), puis les autres colonnes du fichier.
  const reprises = CHAMPS[imp.nature]
    .map((c) => ({ champ: c, i: imp.correspondance.colonnes[c.cle] }))
    .filter((x): x is { champ: (typeof x)["champ"]; i: number } => x.i !== null && x.i !== undefined && x.i < imp.lignes.entetes.length);
  const indicesRepris = new Set(reprises.map((x) => x.i));
  const autres = imp.lignes.entetes.map((e, i) => ({ e, i })).filter((x) => !indicesRepris.has(x.i));
  const ouverte = q.statut === "ouverte";

  return (
    <>
      <EnTete titre="Corriger une ligne en quarantaine" sousTitre={`${imp.nom_fichier} · ligne ${q.numero_ligne} · importé le ${dateHeureFr(imp.cree_le)}`} />
      <Contenu>
        <p className="petit noprint"><Link href="/controles#quarantaine">← Alertes et anomalies</Link> · <Link href={`/import/${imp.id}`}>Import d&apos;origine</Link></p>
        <Message ton={ouverte ? "alerte" : "info"}>
          <b>Motif de la quarantaine :</b> {q.motif}
          {!ouverte && (
            <div style={{ marginTop: 6 }}>
              <Badge ton={q.statut === "corrigee" ? "bon" : "gris"}>{q.statut === "corrigee" ? "Corrigée" : "Rejetée"}</Badge> {q.commentaire}
              {q.traite_par && ` — ${q.traite_par}, ${dateHeureFr(q.traite_le)}`}
            </div>
          )}
        </Message>
        {ouverte && !s.peut("importer") && (
          <Message ton="info">La correction et l&apos;intégration sont réservées aux profils qui importent (back-office, administrateur).</Message>
        )}
        {ouverte && s.peut("importer") && (
          <Carte
            titre="Valeurs de la ligne"
            sousTitre="Corrigez les valeurs en cause, puis « Corriger et intégrer ». La ligne repasse par tous les contrôles de l'import ; si elle est encore refusée, le motif s'affiche et rien n'est enregistré."
          >
            <Formulaire action={integrerLigneQuarantaine} bouton="Corriger et intégrer" confirmation="Intégrer cette ligne corrigée ? Elle sera tracée comme un import à part entière.">
              <input type="hidden" name="id" value={q.id} />
              <div className="form-grille trois">
                {imp.nature === "base_titres" && (
                  <Champ libelle="Date de reprise (position d'ouverture)" obligatoire aide={`Celle de l'import d'origine : ${dateFr(imp.correspondance.dateReprise ?? null)}`}>
                    <input className="champ" type="date" name="date_reprise" defaultValue={imp.correspondance.dateReprise ?? ""} required />
                  </Champ>
                )}
                {reprises.map(({ champ, i }) => (
                  <Champ
                    key={i}
                    libelle={`${imp.lignes.entetes[i]}`}
                    obligatoire={champ.obligatoire}
                    aide={
                      estErreurFormule(valeurs[i] ?? null) || (champ.obligatoire && texte(i) === "")
                        ? <b className="neg">⚠ Valeur à corriger · {champ.libelle}</b>
                        : `Champ Titrix : ${champ.libelle}`
                    }
                  >
                    <input className="champ" name={`v_${i}`} defaultValue={texte(i)} />
                  </Champ>
                ))}
              </div>
              {autres.length > 0 && (
                <details className="depliant" style={{ marginTop: 12 }}>
                  <summary>Autres colonnes du fichier ({autres.length}, non reprises par la correspondance)</summary>
                  <div className="form-grille trois" style={{ paddingTop: 12 }}>
                    {autres.map(({ e, i }) => (
                      <Champ key={i} libelle={e || `Colonne ${i + 1}`}>
                        <input className="champ" name={`v_${i}`} defaultValue={texte(i)} />
                      </Champ>
                    ))}
                  </div>
                </details>
              )}
              <p className="petit mut" style={{ margin: "10px 0 0" }}>
                Montants : chiffres seuls ou à la française (1 250 000,50). Dates : JJ/MM/AAAA ou AAAA-MM-JJ. Taux : « 6,50 % » ou 0,065.
                {imp.nature === "base_titres" && " Après intégration, la position d'ouverture est soumise à la validation d'une autre personne, comme pour tout import."}
              </p>
            </Formulaire>
          </Carte>
        )}
      </Contenu>
    </>
  );
}
