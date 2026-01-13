import { useState, useEffect } from "react";
import { getDeviceId } from "../deviceId";

export function useDeviceId() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    const initDeviceId = async () => {
      try {
        const id = await getDeviceId();
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
