/** @type {import('tailwindcss').Config} */
export default {
  corePlugins: { preflight: false },
  content: [
    './src/**/*.{js,jsx}',
    '../linkedin/src/**/*.{js,jsx}',
  ],
  theme: { extend: {} },
  plugins: [],
}
