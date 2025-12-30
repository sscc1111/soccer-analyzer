/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "rgb(10 10 10)",
        foreground: "rgb(245 245 245)",
        border: "rgb(45 45 45)",
        muted: "rgb(30 30 30)",
        "muted-foreground": "rgb(170 170 170)",
        primary: "rgb(99 102 241)",
        "primary-foreground": "rgb(255 255 255)"
      }
    },
  },
  plugins: [],
}
