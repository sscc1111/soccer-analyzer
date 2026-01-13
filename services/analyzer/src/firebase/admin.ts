import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage as getFirebaseStorage } from "firebase-admin/storage";

let firestoreInitialized = false;

export function getAdminApp() {
  if (admin.apps.length) return admin.app();
  return admin.initializeApp();
}

export function getDb() {
  const db = getFirestore(getAdminApp());
  if (!firestoreInitialized) {
    db.settings({ ignoreUndefinedProperties: true });
    firestoreInitialized = true;
  }
  return db;
}

export function getStorage() {
  return getFirebaseStorage(getAdminApp());
}

export function getBucket() {
  const bucketName = process.env.STORAGE_BUCKET;
  if (!bucketName) {
    throw new Error("STORAGE_BUCKET environment variable is not set");
  }
  return getFirebaseStorage(getAdminApp()).bucket(bucketName);
}
