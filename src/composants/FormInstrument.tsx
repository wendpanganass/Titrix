/**
 * Champs du formulaire instrument (création et modification).
 */
import { Champ } from "./ui";
import type { Referentiels } from "@/donnees/referentiels";
import { CONVENTIONS, LIBELLES_CONVENTION, LIBELLES_FREQUENCE, LIBELLES_PROFIL, PROFILS } from "@/moteur";

export interface ValeursInstrument {
  code_interne?: string;
  isin?: string | null;
  libelle?: string;
  emetteur_id?: string | null;
  pays_code?: string | null;
  zone?: string;
  type_code?: string | null;
  devise_code?: string;
  nominal_unitaire?: number | null;
  date_emission?: string | null;
  date_echeance?: string | null;
  taux_coupon?: number;
  convention?: string;
  frequence?: number;
  profil?: string;
  differe_mois?: number;
  precompte?: boolean;
  taux_retenue?: number;
  conditions_remboursement?: string;
}

export function ChampsInstrument({ r, v = {}, conventionDefaut, deviseDefaut }: { r: Referentiels; v?: ValeursInstrument; conventionDefaut: string; deviseDefaut: string }) {
  const pct = (x?: number) => (x === undefined || x === null ? "" : String(Math.round(x * 1e8) / 1e6).replace(".", ","));
  return (
    <div className="form-grille quatre">
      <Champ libelle="Code interne" aide={v.code_interne ? "Attribué par le système, non modifiable" : "Attribué automatiquement à l'enregistrement : TYPE-PAYS-ANNÉE-N° (ex. OAT-BF-2029-001)"}>
        <input className="champ" value={v.code_interne ?? "Automatique"} readOnly disabled style={{ background: "var(--head)", color: "var(--mut)" }} />
      </Champ>
      <Champ libelle="Code ISIN" aide="Saisie libre, 12 caractères ; facultatif">
        <input className="champ" name="isin" defaultValue={v.isin ?? ""} maxLength={12} />
      </Champ>
      <Champ libelle="Libellé" obligatoire className="plein">
        <input className="champ" name="libelle" defaultValue={v.libelle ?? ""} required />
      </Champ>
      <Champ libelle="Émetteur">
        <select className="champ" name="emetteur_id" defaultValue={v.emetteur_id ?? ""}>
          <option value="">—</option>
          {r.emetteurs.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
        </select>
      </Champ>
      <Champ libelle="Pays">
        <select className="champ" name="pays_code" defaultValue={v.pays_code ?? ""}>
          <option value="">—</option>
          {r.pays.map((p) => <option key={p.code} value={p.code}>{p.nom}</option>)}
        </select>
      </Champ>
      <Champ libelle="Zone">
        <input className="champ" name="zone" defaultValue={v.zone ?? ""} placeholder="UEMOA, CEMAC…" />
      </Champ>
      <Champ libelle="Type d'instrument">
        <select className="champ" name="type_code" defaultValue={v.type_code ?? ""}>
          <option value="">—</option>
          {r.types.map((t) => <option key={t.code} value={t.code}>{t.libelle}</option>)}
        </select>
      </Champ>
      <Champ libelle="Devise" obligatoire>
        <select className="champ" name="devise_code" defaultValue={v.devise_code ?? deviseDefaut} required>
          {r.devises.map((d) => <option key={d.code} value={d.code}>{d.code} — {d.libelle}</option>)}
        </select>
      </Champ>
      <Champ libelle="Nominal unitaire" obligatoire>
        <input className="champ" name="nominal_unitaire" inputMode="decimal" defaultValue={v.nominal_unitaire ?? ""} />
      </Champ>
      <Champ libelle="Date d'émission">
        <input className="champ" type="date" name="date_emission" defaultValue={v.date_emission ?? ""} />
      </Champ>
      <Champ libelle="Date d'échéance" obligatoire>
        <input className="champ" type="date" name="date_echeance" defaultValue={v.date_echeance ?? ""} />
      </Champ>
      <Champ libelle="Taux de coupon (%)" aide="Taux annuel, ex. 6,5">
        <input className="champ" name="taux_coupon" inputMode="decimal" defaultValue={pct(v.taux_coupon)} />
      </Champ>
      <Champ libelle="Convention de décompte" obligatoire aide="Propre à l'instrument : elle prévaut sur le paramètre général">
        <select className="champ" name="convention" defaultValue={v.convention ?? conventionDefaut}>
          {CONVENTIONS.map((c) => <option key={c} value={c}>{LIBELLES_CONVENTION[c]}</option>)}
        </select>
      </Champ>
      <Champ libelle="Fréquence des paiements" obligatoire>
        <select className="champ" name="frequence" defaultValue={String(v.frequence ?? 1)}>
          {Object.entries(LIBELLES_FREQUENCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Champ>
      <Champ libelle="Profil d'amortissement" obligatoire>
        <select className="champ" name="profil" defaultValue={v.profil ?? "in_fine"}>
          {PROFILS.map((p) => <option key={p} value={p}>{LIBELLES_PROFIL[p]}</option>)}
        </select>
      </Champ>
      <Champ libelle="Différé d'amortissement (mois)" aide="Depuis l'émission ; les intérêts restent dus">
        <input className="champ" type="number" min={0} name="differe_mois" defaultValue={v.differe_mois ?? 0} />
      </Champ>
      <Champ libelle="Retenue à la source (%)" aide="Sur les intérêts (IRVM…)">
        <input className="champ" name="taux_retenue" inputMode="decimal" defaultValue={pct(v.taux_retenue)} />
      </Champ>
      <label className="case" style={{ alignSelf: "end" }}>
        <input type="checkbox" name="precompte" defaultChecked={v.precompte ?? false} /> Intérêts précomptés (bon du Trésor)
      </label>
      <Champ libelle="Conditions de remboursement" className="plein">
        <textarea className="champ" name="conditions_remboursement" defaultValue={v.conditions_remboursement ?? ""} rows={2} />
      </Champ>
    </div>
  );
}
