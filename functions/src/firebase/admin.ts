import * as admin from "firebase-admin";

export function getAdminApp() {
  if (admin.apps.length) return admin.app();
  return admin.initializeApp();
}
