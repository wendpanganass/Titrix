"use client";
/**
 * Barre de filtres en listes déroulantes : chaque changement recharge la page avec le filtre dans l'adresse
 * (partageable, imprimable, conservé au changement de date ou de devise).
 */
import Link from "next/link";

export interface FiltreListe {
  nom: string;
  libelle: string;
  valeur: string;
  options: { valeur: string; libelle: string }[];
}

export function Filtres({ filtres, conserver = {}, reinitialiser }: { filtres: FiltreListe[]; conserver?: Record<string, string | undefined>; reinitialiser?: string }) {
  return (
    <form
      className="filtres-tableau noprint"
      method="get"
      // Les listes laissées sur « Tous » ne sont pas envoyées : l'adresse reste lisible.
      onSubmit={(e) => e.currentTarget.querySelectorAll("select").forEach((s) => !s.value && s.removeAttribute("name"))}
    >
      {Object.entries(conserver).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {filtres.map((f) => (
        <label key={f.nom} className={f.valeur ? "actif" : ""}>
          <span className="lib">{f.libelle}</span>
          <select
            className="champ"
            name={f.nom}
            defaultValue={f.valeur}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          >
            <option value="">Tous</option>
            {f.options.map((o) => (
              <option key={o.valeur} value={o.valeur}>{o.libelle}</option>
            ))}
          </select>
        </label>
      ))}
      <noscript><button className="btn-sec btn-mini">Filtrer</button></noscript>
      {reinitialiser && <Link className="btn-sec btn-mini" href={reinitialiser}>Effacer les filtres</Link>}
    </form>
  );
}
