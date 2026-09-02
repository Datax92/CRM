import type { UserRole } from "@/lib/constants/hierarchy";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export function useProtectedRoute(allowedRoles: UserRole[]) {
  const { user, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/");
      return;
    }
    if (role && !allowedRoles.includes(role)) {
      router.replace("/");
    }
  }, [user, role, loading, allowedRoles, router]);

  return { user, role, loading, isAuthorized: user && role && allowedRoles.includes(role) };
}
