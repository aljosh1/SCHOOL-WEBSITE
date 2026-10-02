import { createContext, useCallback, useContext, useEffect, useRef, useState, type DependencyList, type ReactNode } from "react";
import { CheckCircle2, XCircle, X } from "lucide-react";
import { fetchBlob } from "./api";

// ---------------------------------------------------------------- data fetching

export function useFetch<T>(fn: (signal: AbortSignal) => Promise<T>, deps: DependencyList = [], enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    const ctrl = new AbortController();
    setLoading(true);
    fnRef.current(ctrl.signal)
      .then((d) => { setData(d); setError(null); })
      .catch((e: Error) => { if (e.name !== "AbortError") setError(e.message); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload, setData };
}

export function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Loads a protected image (needs the bearer token) as an object URL. */
export function useAuthImage(path?: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    let revoked = false;
    let objectUrl: string | null = null;
    fetchBlob(path).then(({ blob }) => {
      if (revoked) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => setUrl(null));
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);
  return url;
}

// ---------------------------------------------------------------- toasts

interface Toast { id: number; kind: "success" | "error"; text: string }
interface ToastApi { success: (t: string) => void; error: (t: string) => void }
const ToastCtx = createContext<ToastApi>(null!);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  const api = useRef<ToastApi>({ success: (t) => push("success", t), error: (t) => push("error", t) });
  return (
    <ToastCtx.Provider value={api.current}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${t.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>
            {t.kind === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
            <span className="flex-1">{t.text}</span>
            <button aria-label="Dismiss" onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}><X className="size-4 opacity-60" /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
