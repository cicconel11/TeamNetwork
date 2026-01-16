// Fallback entry for hoisted expo in monorepo.
// expo/AppEntry.js does: import App from "../../App"
// When expo is hoisted to /node_modules/expo, that resolves to /App.tsx (this file).
// We re-export the actual mobile app component.
export { App as default } from "expo-router/build/qualified-entry";
