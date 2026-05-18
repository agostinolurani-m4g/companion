import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    /** Sync da localStorage / fetch in mount: pattern validi ma vietati dalla regola sperimentale. */
    rules: {
      "react-hooks/set-state-in-effect": "off",
      /** ETA / clock: Date.now in render è accettabile per UI time-sensitive. */
      "react-hooks/purity": "off",
    },
  },
]);

export default eslintConfig;
