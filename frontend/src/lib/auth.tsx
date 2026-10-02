import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { get, post, tokenStore, type Rec } from "./api";

export type Role = "SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT";
export interface User {
  id: number; username: string; full_name: string; email: string | null; role: Role;
  must_change_password: boolean; teacher_id: number | null; student_id: number | null; permissions: string[];
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
  reload: () => Promise<void>;
  can: (perm: string) => boolean;
  isStaffAdmin: boolean;
}

const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.get());

  const reload = useCallback(async () => {
    if (!tokenStore.get()) { setUser(null); setLoading(false); return; }
    try { setUser(await get<User>("/api/auth/me")); } catch { setUser(null); } finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await post<Rec>("/api/auth/login", { username, password });
    tokenStore.set(res.access_token);
    setUser(res.user);
    return res.user as User;
  }, []);

  const logout = useCallback(() => { tokenStore.clear(); setUser(null); }, []);

  const value = useMemo<AuthCtx>(() => ({
    user, loading, login, logout, reload,
    can: (p) => !!user?.permissions.includes(p),
    isStaffAdmin: user?.role === "SUPER_ADMIN" || user?.role === "ADMIN",
  }), [user, loading, login, logout, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
