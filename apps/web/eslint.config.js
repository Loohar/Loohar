export default [
  {
    ignores: ["dist/**"]
  },
  {
    files: ["src/**/*.{js,jsx}", "*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: {
        caches: "readonly",
        crypto: "readonly",
        document: "readonly",
        fetch: "readonly",
        Intl: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        Response: "readonly",
        self: "readonly",
        window: "readonly"
      }
    },
    rules: {
      "no-undef": "error"
    }
  }
];
