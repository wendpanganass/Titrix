"use client";
/**
 * Parties interactives de la coquille : menu latéral repliable (choix mémorisé), lien actif,
 * bouton mode sombre, bouton imprimer, menu de l'utilisateur.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icone, Symbole, type NomIcone } from "../icones";

export interface LienMenu {
  href: string;
  libelle: string;
  icone: NomIcone;
  compteur?: number;
}
export interface RubriqueMenu {
  titre: string;
  liens: LienMenu[];
}

function lireStockage(cle: string): string | null {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
}
function ecrireStockage(cle: string, v: string) {
  try {
    localStorage.setItem(cle, v);
  } catch {
    /* navigation privée : sans conséquence */
  }
}

export function MenuLateral({ rubriques, etablissement }: { rubriques: RubriqueMenu[]; etablissement: string }) {
  const chemin = usePathname();
  const [replie, setReplie] = useState(false);
  useEffect(() => {
    // Lecture différée du choix mémorisé (le stockage n'existe pas côté serveur).
    const t = setTimeout(() => setReplie(lireStockage("titrix_menu") === "replie"), 0);
    return () => clearTimeout(t);
  }, []);
  const actif = (href: string) => (href === "/" ? chemin === "/" : chemin === href || chemin.startsWith(href + "/"));
  return (
    <aside className={`sidebar ${replie ? "replie" : ""}`}>
      <div className="sb-tete">
        <Symbole taille={34} />
        <div className="marque">
          <b>Titrix</b>
          <span title={etablissement}>{etablissement}</span>
        </div>
        <button
          className="btn-replier"
          title={replie ? "Déplier le menu" : "Replier le menu"}
          onClick={() => {
            setReplie(!replie);
            ecrireStockage("titrix_menu", replie ? "deplie" : "replie");
          }}
        >
          <Icone nom={replie ? "deplier" : "replier"} width={16} height={16} />
        </button>
      </div>
      <nav className="snav" aria-label="Menu principal">
        {rubriques.map((r) => (
          <div key={r.titre} style={{ display: "contents" }}>
            <div className="grp">{r.titre}</div>
            {r.liens.map((l) => (
              <Link key={l.href} href={l.href} className={actif(l.href) ? "on" : ""} title={l.libelle}>
                <Icone nom={l.icone} />
                <span>{l.libelle}</span>
                {!!l.compteur && <em className="compteur" style={{ fontStyle: "normal" }}>{l.compteur}</em>}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="sb-pied">Titrix · gestion des titres financiers</div>
    </aside>
  );
}

export function BoutonTheme() {
  const basculer = () => {
    const sombre = document.documentElement.classList.toggle("dark");
    ecrireStockage("titrix_theme", sombre ? "sombre" : "clair");
  };
  return (
    <button className="icone-btn" onClick={basculer} title="Mode clair / sombre" aria-label="Mode clair ou sombre">
      <Icone nom="lune" />
    </button>
  );
}

export function BoutonImprimer() {
  return (
    <button className="icone-btn" onClick={() => window.print()} title="Imprimer / exporter en PDF" aria-label="Imprimer">
      <Icone nom="imprimer" />
    </button>
  );
}

export function MenuUtilisateur({
  nom,
  email,
  roles,
  deconnexion,
}: {
  nom: string;
  email: string;
  roles: string;
  deconnexion: () => Promise<void>;
}) {
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fermer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("click", fermer);
    return () => document.removeEventListener("click", fermer);
  }, []);
  const initiales = nom
    .split(/\s+/)
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="menu-utilisateur" ref={ref}>
      <button className="avatar" onClick={() => setOuvert(!ouvert)} aria-label="Menu du compte" title={nom}>
        {initiales}
      </button>
      {ouvert && (
        <div className="menu-flottant">
          <div className="qui">
            <b>{nom}</b>
            <span>{email}</span>
            <span style={{ display: "block", marginTop: 4 }}>{roles}</span>
          </div>
          <Link href="/compte">Mon compte</Link>
          <form action={deconnexion}>
            <button type="submit" className="rouge">
              Déconnexion
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/** Sélecteur de date d'arrêté : recharge la page avec ?date=… (toutes les vues utilisent la même date). */
export function SelecteurDate({ date, conserver = {} }: { date: string; conserver?: Record<string, string | undefined> }) {
  return (
    <form className="date-arrete noprint" method="get" title="Date d'arrêté des calculs">
      {Object.entries(conserver).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      Arrêté au
      <input type="date" name="date" defaultValue={date} onChange={(e) => e.currentTarget.form?.requestSubmit()} />
    </form>
  );
}
