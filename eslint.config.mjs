import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Règles d'analyse : peu de règles, toutes crédibles.
const config = [
  ...nextVitals,
  ...nextTs,
  { rules: { "no-console": ["warn", { allow: ["error", "warn"] }] } },
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
];
export default config;
