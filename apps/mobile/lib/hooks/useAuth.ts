import { useState, useEffect } from "react";
import { User } from "firebase/auth";
import { ensureAuthenticated, onAuthChange } from "../firebase/auth";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        const authenticatedUser = await ensureAuthenticated();
        if (mounted) {
          setUser(authenticatedUser);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error("Authentication failed"));
          setLoading(false);
        }
      }
    };

    initAuth();

    // Listen for auth state changes
    const unsubscribe = onAuthChange((authUser) => {
      if (mounted) {
        setUser(authUser);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { user, loading, error, isAuthenticated: !!user };
}
