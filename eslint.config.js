import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Lint tooling is installed in server/, so resolve it from there.
var resolveTool = createRequire(new URL("./server/package.json", import.meta.url)).resolve;

/** @param {string} name */
async function tool(name) {
  var loaded = await import(pathToFileURL(resolveTool(name)).href);
  return loaded.default || loaded;
}

var js = await tool("@eslint/js");
var globals = await tool("globals");
var html = await tool("eslint-plugin-html");

var rules = Object.assign({}, js.configs.recommended.rules, {
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-unused-vars": ["error", { args: "after-used", caughtErrors: "all" }],
  "no-shadow": "error",
  "no-use-before-define": ["error", { functions: false, variables: false }],
  "no-console": "error",
  "no-alert": "error",
  "no-eval": "error",
  "no-new-func": "error",
  "no-duplicate-imports": "error",
  "no-useless-return": "error",
  "no-else-return": "error",
  "no-lonely-if": "error"
});

export default [
  {
    ignores: ["server/node_modules/**", "server/prisma/**", "node_modules/**"]
  },
  {
    files: ["server/src/**/*.js", "server/test/**/*.js", "server/qa/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: globals.node },
    rules: rules
  },
  {
    files: ["server/src/log.js", "server/qa/**/*.js"],
    rules: { "no-console": "off" }
  },
  {
    files: ["assets/**/*.js"],
    languageOptions: { ecmaVersion: 2020, sourceType: "script", globals: globals.browser },
    rules: rules
  },
  {
    files: ["*.html"],
    plugins: { html: html },
    languageOptions: { ecmaVersion: 2020, sourceType: "script", globals: globals.browser },
    rules: rules
  }
];
