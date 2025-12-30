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
        "primary-foreground": "rgb(255 255 255)",
        destructive: "rgb(239 68 68)",
        "destructive-foreground": "rgb(255 255 255)",
        success: "rgb(34 197 94)",
        "success-foreground": "rgb(255 255 255)",
        warning: "rgb(234 179 8)",
        "warning-foreground": "rgb(0 0 0)",
        card: "rgb(20 20 20)",
        "card-foreground": "rgb(245 245 245)",
        accent: "rgb(45 45 45)",
        "accent-foreground": "rgb(245 245 245)"
      }
    },
  },
  plugins: [],
}
