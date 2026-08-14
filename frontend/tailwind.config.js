/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 深色 EDA 主题
        wavebg: "#0D1117",
        panel: "#161B22",
        panel2: "#1C2128",
        accent: "#1F6FEB",
        accent2: "#58A6FF",
        text1: "#E6EDF3",
        text2: "#8B949E",
        text3: "#F0F6FC",
        good: "#4ADE80",
        warn: "#FACC15",
        danger: "#F87171",
        critical: "#EF4444",
      },
      fontFamily: {
        sans: ["Segoe UI", "PingFang SC", "Microsoft YaHei", "sans-serif"],
        mono: ["Consolas", "Cascadia Mono", "JetBrains Mono", "monospace"],
      },
      keyframes: {
        "slide-in": {
          "0%": { opacity: "0", transform: "translateX(-8px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "slide-in": "slide-in 200ms ease",
        "fade-in": "fade-in 200ms ease",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
