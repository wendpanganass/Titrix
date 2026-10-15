/**
 * Mise en page de la connexion : deux moitiés sur un dégradé, arguments à gauche, carte à droite.
 */
import type { ReactNode } from "react";
import { Symbole } from "./icones";

const ARGUMENTS = [
  "Référentiel unique des titres, positions séparées par conservateur",
  "Échéanciers, coupons courus et disponibles calculés à toute date d'arrêté",
  "Validations à quatre yeux, arrêtés verrouillés et journal d'audit complet",
];

function Illustration() {
  return (
    <svg className="cx-illus" viewBox="0 0 440 200" role="img" aria-label="Échéancier et portefeuille">
      <g className="flotte">
        <rect x="10" y="20" width="250" height="150" rx="14" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.25)" />
        {[0, 1, 2, 3, 4, 5, 6].map((k) => (
          <rect key={k} x={34 + k * 31} y={150 - [40, 40, 60, 40, 80, 40, 110][k]} width="18" height={[40, 40, 60, 40, 80, 40, 110][k]} rx="4"
            fill={k === 6 ? "#e6b93a" : "rgba(255,255,255,.55)"} />
        ))}
        <line x1="30" y1="150" x2="245" y2="150" stroke="rgba(255,255,255,.35)" />
      </g>
      <g className="flotte2">
        <rect x="280" y="50" width="150" height="110" rx="14" fill="#ffffff" />
        <text x="298" y="80" fontSize="11" fill="#64748b" fontFamily="inherit">Nominal disponible</text>
        <rect x="298" y="92" width="114" height="9" rx="4.5" fill="#eef2f9" />
        <rect x="298" y="92" width="78" height="9" rx="4.5" fill="#1f4e8c" />
        <text x="298" y="124" fontSize="11" fill="#64748b" fontFamily="inherit">Grevé</text>
        <rect x="298" y="134" width="114" height="9" rx="4.5" fill="#eef2f9" />
        <rect x="298" y="134" width="36" height="9" rx="4.5" fill="#d4a017" />
      </g>
    </svg>
  );
}

export function PageConnexion({ titre, sousTitre, children }: { titre: string; sousTitre: string; children: ReactNode }) {
  return (
    <div className="cx">
      <div className="cx-gauche">
        <div className="logo">
          <Symbole taille={40} clair />
          Titrix
        </div>
        <h2>
          Vos titres financiers, <em>traçables</em> de l&apos;acquisition au remboursement.
        </h2>
        <ul>
          {ARGUMENTS.map((a) => (
            <li key={a}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              {a}
            </li>
          ))}
        </ul>
        <Illustration />
      </div>
      <div className="cx-droite">
        <div className="cx-form">
          <h1>{titre}</h1>
          <p className="sous">{sousTitre}</p>
          {children}
          <div className="pied">Titrix · gestion des titres financiers</div>
        </div>
      </div>
    </div>
  );
}
