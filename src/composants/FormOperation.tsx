/**
 * Champs du formulaire d'opération (création et modification de brouillon).
 */
import { Champ } from "./ui";
import { LIBELLES_OPERATION, TYPES_OPERATION } from "@/moteur";

export interface ValeursOperation {
  type?: string;
  date_effet?: string | null;
  date_negociation?: string | null;
  date_reglement?: string | null;
  quantite?: number | null;
  nominal?: number | null;
  prix?: number | null;
  unite_cotation?: string;
  coupon_couru?: number | null;
  frais?: number | null;
  montant_regle?: number | null;
  contrepartie_id?: string | null;
  position_destination_id?: string | null;
  echeance_id?: string | null;
  operation_annulee_id?: string | null;
  reference?: string;
  commentaire?: string;
}

export function ChampsOperation({
  v = {},
  contreparties,
  destinations,
  echeances = [],
  annulees = [],
}: {
  v?: ValeursOperation;
  contreparties: { id: string; nom: string }[];
  destinations: { id: string; libelle: string }[];
  echeances?: { id: string; libelle: string }[];
  annulees?: { id: string; libelle: string }[];
}) {
  const n = (x?: number | null) => (x === null || x === undefined ? "" : String(x));
  return (
    <div className="form-grille quatre">
      <Champ libelle="Type d'opération" obligatoire>
        <select className="champ" name="type" defaultValue={v.type ?? "acquisition"}>
          {TYPES_OPERATION.map((t) => <option key={t} value={t}>{LIBELLES_OPERATION[t]}</option>)}
        </select>
      </Champ>
      <Champ libelle="Date d'effet" obligatoire aide="Date à laquelle la position change">
        <input className="champ" type="date" name="date_effet" defaultValue={v.date_effet ?? ""} required />
      </Champ>
      <Champ libelle="Nominal" obligatoire aide="Montant nominal concerné">
        <input className="champ" name="nominal" inputMode="decimal" defaultValue={n(v.nominal)} required />
      </Champ>
      <Champ libelle="Quantité (titres)">
        <input className="champ" name="quantite" inputMode="decimal" defaultValue={n(v.quantite)} />
      </Champ>
      <Champ libelle="Date de négociation" aide="Obligatoire pour acquisition / cession">
        <input className="champ" type="date" name="date_negociation" defaultValue={v.date_negociation ?? ""} />
      </Champ>
      <Champ libelle="Date de règlement" aide="Obligatoire pour acquisition / cession">
        <input className="champ" type="date" name="date_reglement" defaultValue={v.date_reglement ?? ""} />
      </Champ>
      <Champ libelle="Prix" aide="Obligatoire pour acquisition / cession">
        <input className="champ" name="prix" inputMode="decimal" defaultValue={n(v.prix)} />
      </Champ>
      <Champ libelle="Unité de cotation">
        <select className="champ" name="unite_cotation" defaultValue={v.unite_cotation ?? "pourcentage"}>
          <option value="pourcentage">% du pair</option>
          <option value="montant">Montant par titre</option>
        </select>
      </Champ>
      <Champ libelle="Coupon couru payé / reçu">
        <input className="champ" name="coupon_couru" inputMode="decimal" defaultValue={n(v.coupon_couru)} />
      </Champ>
      <Champ libelle="Frais">
        <input className="champ" name="frais" inputMode="decimal" defaultValue={n(v.frais)} />
      </Champ>
      <Champ libelle="Montant réglé">
        <input className="champ" name="montant_regle" inputMode="decimal" defaultValue={n(v.montant_regle)} />
      </Champ>
      <Champ libelle="Contrepartie" aide="Obligatoire pour acquisition / cession">
        <select className="champ" name="contrepartie_id" defaultValue={v.contrepartie_id ?? ""}>
          <option value="">—</option>
          {contreparties.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
      </Champ>
      <Champ libelle="Position de destination" aide="Transfert uniquement : même instrument, autre conservateur">
        <select className="champ" name="position_destination_id" defaultValue={v.position_destination_id ?? ""}>
          <option value="">—</option>
          {destinations.map((d) => <option key={d.id} value={d.id}>{d.libelle}</option>)}
        </select>
      </Champ>
      <Champ libelle="Échéance réalisée" aide="Amortissement / remboursement constaté">
        <select className="champ" name="echeance_id" defaultValue={v.echeance_id ?? ""}>
          <option value="">—</option>
          {echeances.map((e) => <option key={e.id} value={e.id}>{e.libelle}</option>)}
        </select>
      </Champ>
      <Champ libelle="Corrige l'opération annulée">
        <select className="champ" name="operation_annulee_id" defaultValue={v.operation_annulee_id ?? ""}>
          <option value="">—</option>
          {annulees.map((e) => <option key={e.id} value={e.id}>{e.libelle}</option>)}
        </select>
      </Champ>
      <Champ libelle="Référence (avis d'opéré, relevé…)">
        <input className="champ" name="reference" defaultValue={v.reference ?? ""} />
      </Champ>
      <Champ libelle="Commentaire" className="plein">
        <input className="champ" name="commentaire" defaultValue={v.commentaire ?? ""} />
      </Champ>
    </div>
  );
}
