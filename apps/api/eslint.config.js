// apps/api had no real linting: its lint script was `node --check src/server.js`, a syntax check of
// one file. A missing import in orderPaymentService.js passed that check on 2026-09-20 and would
// have thrown a ReferenceError on the checkout replay path (L-59). no-undef across the whole API
// catches that class of defect before it reaches a customer.
export default [
  {
    ignores: ["prisma/migrations/**", "node_modules/**"]
  },
  {
    files: ["src/**/*.js", "prisma/**/*.js", "*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        FormData: "readonly",
        Blob: "readonly",
        fetch: "readonly",
        crypto: "readonly",
        performance: "readonly",
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        queueMicrotask: "readonly",
        structuredClone: "readonly",
        globalThis: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "writable",
        require: "readonly",
        exports: "writable"
      }
    },
    rules: {
      "no-undef": "error",
      // ignoreRestSiblings keeps the deliberate "destructure to drop" idiom that strips passwords,
      // hashes and tenant internals out of responses before a spread.
      "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_", ignoreRestSiblings: true }]
    }
  }
];
