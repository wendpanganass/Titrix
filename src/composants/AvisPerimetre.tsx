/**
 * Explique pourquoi des données attendues n'apparaissent pas dans les restitutions :
 *  - compte limité à certains portefeuilles alors que d'autres portefeuilles portent des positions ;
 *  - opérations (dont positions d'ouverture importées) encore en attente de validation ;
 *  - positions qui ne commencent qu'après la date d'arrêté choisie.
 * Rien n'est affiché quand tout est visible.
 */
import Link from "next/link";
import { Message } from "@/composants/ui";
import { lire } from "@/lib/db";
import type { Session } from "@/lib/session";
import { dateFr } from "@/lib/format";

export async function AvisPerimetre({ s, date }: { s: Session; date: string }) {
  const pf = s.u.portefeuilles;
  const [hors, autorises, attente, futures] = await Promise.all([
    pf.length
      ? lire<{ libelle: string; positions: number }>(
          `select f.libelle, count(distinct p.id)::int as positions
             from positions p join portefeuilles f on f.id = p.portefeuille_id
            where not (p.portefeuille_id = any($1::uuid[]))
              and exists (select 1 from operations o where o.position_id = p.id and o.statut in ('valide','regle','soumis'))
            group by f.libelle order by 2 desc`,
          [pf],
        )
      : Promise.resolve([]),
    pf.length ? lire<{ libelle: string }>("select libelle from portefeuilles where id = any($1::uuid[]) order by libelle", [pf]) : Promise.resolve([]),
    lire<{ total: number; importees: number }>(
      `select count(*)::int as total, count(*) filter (where o.cle_import is not null)::int as importees
         from operations o join positions p on p.id = o.position_id
        where o.statut = 'soumis' and (cardinality($1::uuid[]) = 0 or p.portefeuille_id = any($1::uuid[]))`,
      [pf],
    ),
    lire<{ positions: number; debut: string | null }>(
      `select count(distinct p.id)::int as positions, min(o.date_effet)::text as debut
         from operations o join positions p on p.id = o.position_id
        where o.statut in ('valide','regle') and o.date_effet > $2
          and not exists (select 1 from operations x where x.position_id = p.id and x.statut in ('valide','regle') and x.date_effet <= $2)
          and (cardinality($1::uuid[]) = 0 or p.portefeuille_id = any($1::uuid[]))`,
      [pf, date],
    ),
  ]);
  const nbHors = hors.reduce((t, h) => t + h.positions, 0);
  const a = attente[0] ?? { total: 0, importees: 0 };
  const f = futures[0] ?? { positions: 0, debut: null };
  if (!nbHors && !a.total && !f.positions) return null;
  return (
    <>
      {nbHors > 0 && (
        <Message ton="alerte">
          Votre compte ne voit que {autorises.length > 1 ? "les portefeuilles" : "le portefeuille"} <b>{autorises.map((x) => x.libelle).join(", ")}</b>.{" "}
          {nbHors} position(s) d&apos;autres portefeuilles ({hors.map((h) => `${h.libelle} : ${h.positions}`).join(", ")}) sont hors de votre périmètre.
          Un administrateur peut l&apos;élargir dans <b>Utilisateurs → Modifier → Périmètre</b> (aucune case cochée = tous les portefeuilles).
        </Message>
      )}
      {a.total > 0 && (
        <Message ton="info">
          {a.total} opération(s) attendent la validation{a.importees > 0 ? `, dont ${a.importees} position(s) d'ouverture importée(s)` : ""} : elles
          n&apos;entrent dans l&apos;encours, l&apos;échéancier et les analyses qu&apos;une fois validées par un validateur (autre que la personne qui les a saisies).{" "}
          {s.peut("valider") && <Link href="/operations?vue=a_valider"><b>Les valider →</b></Link>}
        </Message>
      )}
      {f.positions > 0 && f.debut && (
        <Message ton="info">
          {f.positions} position(s) ne commencent qu&apos;après la date d&apos;arrêté (première date d&apos;effet : {dateFr(f.debut)}) : choisissez une date
          d&apos;arrêté postérieure pour les voir.
        </Message>
      )}
    </>
  );
}
