import { initializeApp, getApps, App } from "firebase-admin/app";

// Initialize Firebase Admin at module load time
const adminApp: App = getApps().length === 0 ? initializeApp() : getApps()[0];

export function getAdminApp(): App {
  return adminApp;
}
