/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    // ✅ Scan all .ts and .js files for class usage (e.g., styles.container)
    // ✅ Scan all .module.css files for @apply directives
    "./src/**/*.{js,ts,css,module.css}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // We override the default 'sans' stack.
        // 1. "Inter": Used for all Latin characters (English UI).
        // 2. "Noto Sans JP": Used for Japanese characters (fallback).
        // 3. System fonts: Fallbacks for other OS/scenarios.
        sans: [
          '"Inter"',
          '"Noto Sans JP"',
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
      },
    },
  },
  plugins: [],
};
