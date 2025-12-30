import { getFirestore } from "firebase/firestore";
import { getFirebaseApp } from "./client";

export const db = getFirestore(getFirebaseApp());
