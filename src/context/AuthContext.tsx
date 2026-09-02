"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { User } from "firebase/auth";
import { IS_DEMO, useDemoSession, signInDemo, signOutDemo, DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/demo/store";

/**
 * The three access roles. `subadmin` reads the same screens an admin does,
 * scoped to their own team — see `lib/constants/hierarchy`.
 */
type Role = "admin" | "subadmin" | "employee";

interface AuthContextType {
  user: { uid: string; email: string | null } | null;
  role: Role | null;
  loading: boolean;
  /** Set when the account is authenticated but unusable — no role, or disabled. */
  roleError: string | null;
  signIn: (email: string, password: string, expectedRole?: Role) => Promise<void>;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  loading: true,
  roleError: null,
  signIn: async () => {},
  logout: async () => {},
  getIdToken: async () => {
    throw new Error("Not signed in");
  },
});

/**
 * Authentication state.
 *
 * Two mutually exclusive modes, chosen at build time by NEXT_PUBLIC_DEMO_MODE:
 *
 *  - Demo: sign-in is checked against a fixed list of accounts held in memory.
 *    No Firebase is loaded at all. A banner marks every screen.
 *  - Real: Firebase Auth, with the role read from the `role` custom claim that
 *    only the Admin SDK can set.
 *
 * The important property is that the demo path cannot reach a database. The
 * previous build's demo mode issued tokens a permissive server check accepted
 * as admin against the live project; this one has nothing to talk to.
 */
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<{ uid: string; email: string | null } | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const demoSession = useDemoSession();

  // --- real Firebase auth ---------------------------------------------------
  useEffect(() => {
    if (IS_DEMO) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    (async () => {
      const { onAuthStateChanged } = await import("firebase/auth");
      const { auth } = await import("@/lib/firebase/client");
      if (cancelled) return;

      unsubscribe = onAuthStateChanged(auth, async (currentUser: User | null) => {
        if (!currentUser) {
          setUser(null);
          setRole(null);
          setRoleError(null);
          setLoading(false);
          return;
        }

        setUser({ uid: currentUser.uid, email: currentUser.email });

        try {
          let claims = (await currentUser.getIdTokenResult()).claims;

          // A claim set after this session began — a newly promoted admin, say —
          // is not in the cached token. Refresh once before giving up.
          if (!claims.role) {
            claims = (await currentUser.getIdTokenResult(true)).claims;
          }

          const claimedRole = claims.role;
          if (claimedRole === "admin" || claimedRole === "subadmin" || claimedRole === "employee") {
            setRole(claimedRole);
            setRoleError(null);
          } else {
            setRole(null);
            setRoleError(
              "This account has no role assigned yet. Ask your administrator to set one, then sign in again."
            );
          }
        } catch (error) {
          console.error("[auth] Could not read role claim:", error);
          setRole(null);
          setRoleError("Could not verify your access. Please sign in again.");
        } finally {
          setLoading(false);
        }
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string, expectedRole?: Role) => {
    if (IS_DEMO) {
      const account = DEMO_ACCOUNTS.find((a) => a.email === email.trim());
      if (account && password === DEMO_PASSWORD) {
        if (expectedRole && account.role !== expectedRole) {
          const error = new Error("Role mismatch") as Error & { code?: string };
          error.code = "auth/role-mismatch";
          throw error;
        }
      }

      if (!signInDemo(email, password)) {
        const error = new Error("Invalid demo credentials") as Error & { code?: string };
        error.code = "auth/invalid-credential";
        throw error;
      }
      return;
    }

    const { signInWithEmailAndPassword, signOut } = await import("firebase/auth");
    const { auth } = await import("@/lib/firebase/client");
    const userCred = await signInWithEmailAndPassword(auth, email.trim(), password);

    if (expectedRole) {
      let claims = (await userCred.user.getIdTokenResult()).claims;
      if (!claims.role) {
        claims = (await userCred.user.getIdTokenResult(true)).claims;
      }
      if (claims.role !== expectedRole) {
        await signOut(auth);
        const error = new Error("Role mismatch") as Error & { code?: string };
        error.code = "auth/role-mismatch";
        throw error;
      }
    }
  }, []);

  const logout = useCallback(async () => {
    if (IS_DEMO) {
      signOutDemo();
      return;
    }

    const { signOut } = await import("firebase/auth");
    const { auth } = await import("@/lib/firebase/client");
    await signOut(auth);
    setUser(null);
    setRole(null);
    setRoleError(null);
  }, []);

  const getIdToken = useCallback(async () => {
    if (IS_DEMO) return "demo";

    const { auth } = await import("@/lib/firebase/client");
    const current = auth.currentUser;
    if (!current) throw new Error("Your session has ended. Please sign in again.");
    return current.getIdToken();
  }, []);

  const value = IS_DEMO
    ? {
        user: demoSession ? { uid: demoSession.uid, email: demoSession.email } : null,
        role: demoSession?.role ?? null,
        loading: false,
        roleError: null,
        signIn,
        logout,
        getIdToken,
      }
    : { user, role, loading, roleError, signIn, logout, getIdToken };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
