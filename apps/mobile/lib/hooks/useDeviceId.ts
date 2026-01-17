import { useState, useEffect } from "react";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { getDeviceId } from "../deviceId";
import { db } from "../firebase/firestore";
import { getFirebaseAuth } from "../firebase/auth";

/**
 * P0-SECURITY: deviceIdをusers/{uid}に保存してFirestoreルールで検証可能にする
 */
export function useDeviceId() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    const initDeviceId = async () => {
      try {
        const id = await getDeviceId();

        // P0-SECURITY: 認証済みの場合、deviceIdをusers/{uid}に保存
        // これによりFirestoreルールでdeviceIdを検証可能になる
        const user = getFirebaseAuth().currentUser;
        if (user) {
          const userRef = doc(db, "users", user.uid);
          const userSnap = await getDoc(userRef);

          // 既存のdeviceIdと異なる場合のみ更新（書き込み削減）
          const existingDeviceId = userSnap.data()?.deviceId;
          if (existingDeviceId !== id) {
            await setDoc(userRef, { deviceId: id }, { merge: true });
          }
        }

        if (mounted) {
          setDeviceId(id);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error("Failed to get device ID"));
          setLoading(false);
        }
      }
    };

    initDeviceId();

    return () => {
      mounted = false;
    };
  }, []);

  return { deviceId, loading, error };
}
