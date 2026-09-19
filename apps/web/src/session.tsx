import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AthleteProfile, User } from "@montre/core";
import { ApiError, api, getToken, setToken } from "./api.ts";

/** Recharge les donnees de session apres un changement venu d'ailleurs. */
export type SessionReloader = () => Promise<void>;

/** Session courante : utilisateur connecte et profil sportif. */
interface SessionValue {
  user: User | null;
  profile: AthleteProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // En mode autonome il n'y a pas de comptes : l'athlete local existe
    // toujours, on entre directement dans l'application.
    if (api.requiresAuth && !getToken()) {
      setLoading(false);
      return;
    }
    try {
      const { user: me, profile: myProfile } = await api.me();
      setUser(me);
      setProfile(myProfile);
    } catch (error) {
      // Jeton expire ou revoque : on repart sur un etat deconnecte propre.
      if (error instanceof ApiError && error.status === 401) setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      profile,
      loading,
      login: async (email, password) => {
        const result = await api.login(email, password);
        setToken(result.token);
        setUser(result.user);
        const me = await api.me();
        setProfile(me.profile);
      },
      register: async (email, password, displayName) => {
        const result = await api.register(email, password, displayName);
        setToken(result.token);
        setUser(result.user);
        const me = await api.me();
        setProfile(me.profile);
      },
      logout: async () => {
        try {
          await api.logout();
        } finally {
          setToken(null);
          // Sans comptes, il n'y a rien a quitter : on reste dans l'application.
          if (api.requiresAuth) {
            setUser(null);
            setProfile(null);
          }
        }
      },
      refreshProfile: async () => {
        const me = await api.me();
        // Le nom affiche peut changer en meme temps que le profil sportif.
        setUser(me.user);
        setProfile(me.profile);
      },
    }),
    [user, profile, loading],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession doit etre utilise dans un SessionProvider");
  return context;
}
