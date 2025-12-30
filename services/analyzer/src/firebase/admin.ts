import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

export function getAdminApp() {
  if (admin.apps.length) return admin.app();
  return admin.initializeApp();
}

export function getDb() {
  return getFirestore(getAdminApp());
}

export function getBucket() {
  return getStorage(getAdminApp()).bucket();
}
