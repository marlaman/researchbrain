import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { db } from "../lib/butterbase";
import type { Session } from "@butterbase/sdk";

interface AuthContextValue {
  session: Session | null;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Synchronous: SDK restores session from localStorage in its constructor
  const [session, setSession] = useState<Session | null>(() =>
    db.sessionManager.getSession()
  );

  useEffect(() => {
    const { unsubscribe } = db.onAuthStateChange((_event, s) => setSession(s));
    return unsubscribe;
  }, []);

  async function signIn(
    email: string,
    password: string
  ): Promise<{ error: Error | null }> {
    const { error } = await db.auth.signIn({ email, password });
    // On success the SDK calls setSessionFromLoginResponse → onAuthStateChange fires
    return { error };
  }

  async function signOut() {
    await db.auth.signOut();
    // onAuthStateChange fires with null
  }

  return (
    <AuthContext.Provider value={{ session, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
