import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Scratch space: verification logs and the throwaway CommonJS check scripts
    // that go with them (see Temp/*.txt for the commands they were run with).
    "Temp/**",
    // The tracked tools that read the site and capture its HTML. Deliberately
    // CommonJS and dependency-free: they run with a plain `node scripts/x.cjs`, with
    // no build step, so that the one that reads the deployed HTML is still runnable
    // when the app is the thing that is broken. This config is for `app/`, which is
    // TypeScript and bundled, so the two rulesets are kept apart on purpose.
    "scripts/**",
  ]),
]);

export default eslintConfig;
