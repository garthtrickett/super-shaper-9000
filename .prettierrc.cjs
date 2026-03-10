/** @type {import('prettier').Config} */
module.exports = {
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  printWidth: 80,
  plugins: ["prettier-plugin-tailwindcss"],
  // Add this line to fix whitespace formatting in Lit templates
  // htmlWhitespaceSensitivity: "ignore",
};
4
