import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // A leading underscore marks a value that is destructured only to leave it out
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Missing dependencies are how stale state sneaks in; they must be fixed, not just noticed
      "react-hooks/exhaustive-deps": "error",
      // Only meaningful when the React Compiler rewrites components; this project doesn't use it
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
);
