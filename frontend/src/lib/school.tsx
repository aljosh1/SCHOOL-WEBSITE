import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiUrl, get, type Rec } from "./api";
import { ramp } from "./utils";

export interface School extends Rec {
  name: string; short_name: string; motto: string | null; address: string | null; phone: string | null; email: string | null;
  logo_url: string | null; hero_url: string | null; primary_color: string; secondary_color: string; core_values: string[];
  current_session: { id: number; name: string } | null; current_term: { id: number; name: string } | null;
}

interface Ctx { school: School | null; error: string | null; reload: () => Promise<void>; logo: string | null }
const SchoolCtx = createContext<Ctx>(null!);
export const useSchool = () => useContext(SchoolCtx);

function applyBrand(school: School) {
  const root = document.documentElement.style;
  for (const [name, hex] of [["brand", school.primary_color], ["accent", school.secondary_color]] as const) {
    for (const [shade, value] of Object.entries(ramp(hex))) root.setProperty(`--color-${name}-${shade}`, value);
  }
  document.title = school.name;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", school.primary_color);
}

export function SchoolProvider({ children }: { children: ReactNode }) {
  const [school, setSchool] = useState<School | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const s = await get<School>("/api/public/school");
      setSchool(s);
      setError(null);
      applyBrand(s);
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const value = useMemo(() => ({ school, error, reload, logo: school?.logo_url ? apiUrl(school.logo_url) : null }), [school, error, reload]);
  return <SchoolCtx.Provider value={value}>{children}</SchoolCtx.Provider>;
}
