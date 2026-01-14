import { useState, useEffect } from "react";
import { getDownloadURL, ref } from "firebase/storage";
import { storage } from "../firebase/storage";

type UseStorageUrlResult = {
  url: string | null;
  loading: boolean;
  error: Error | null;
};

/**
 * Hook to convert Firebase Storage path to download URL
 * @param storagePath - Firebase Storage path (e.g., "matches/xxx/clips/clip_1.mp4")
 * @returns Download URL, loading state, and error
 */
export function useStorageUrl(storagePath: string | null | undefined): UseStorageUrlResult {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!storagePath) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return;
    }

    // If it's already a URL (starts with http), use it directly
    if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
      setUrl(storagePath);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchUrl = async () => {
      try {
        const storageRef = ref(storage, storagePath);
        const downloadUrl = await getDownloadURL(storageRef);
        if (!cancelled) {
          setUrl(downloadUrl);
          setLoading(false);
        }
      } catch (err) {
        console.error("Error getting download URL:", err);
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error("Failed to get download URL"));
          setLoading(false);
        }
      }
    };

    fetchUrl();

    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  return { url, loading, error };
}
