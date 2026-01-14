// Fallback entry for hoisted expo in monorepo.
// expo/AppEntry.js does: import App from "../../App"
// When expo is hoisted to /node_modules/expo, that resolves to /App.tsx (this file).
// We re-export from the actual mobile app entry.
export { default } from "./apps/mobile/App";
