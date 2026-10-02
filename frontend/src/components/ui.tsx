import {
  createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- buttons

type Variant = "primary" | "accent" | "outline" | "ghost" | "danger" | "soft";
type Size = "sm" | "md" | "lg";
const variants: Record<Variant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 shadow-xs",
  accent: "bg-accent-600 text-white hover:bg-accent-700 shadow-xs",
  outline: "border border-line bg-white text-ink hover:border-brand-400 hover:bg-brand-50",
  ghost: "text-ink hover:bg-stone-100",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-xs",
  soft: "bg-brand-50 text-brand-800 hover:bg-brand-100",
};
const sizes: Record<Size, string> = { sm: "h-9 px-3 text-sm gap-1.5", md: "h-11 px-4 text-[15px] gap-2", lg: "h-12 px-6 text-base gap-2" };
export const btn = (v: Variant = "primary", s: Size = "md", extra?: string) =>
  cn("inline-flex items-center justify-center rounded-lg font-semibold transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-50", variants[v], sizes[s], extra);

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: Size; loading?: boolean }
export const Button = forwardRef<HTMLButtonElement, BtnProps>(({ variant, size, loading, className, children, disabled, type = "button", ...p }, ref) => (
  <button ref={ref} type={type} className={btn(variant, size, className)} disabled={disabled || loading} {...p}>
    {loading && <Loader2 className="size-4 animate-spin" />}
    {children}
  </button>
));

// ---------------------------------------------------------------- layout atoms

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => <div className={cn("card", className)}>{children}</div>;

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="no-print mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[15px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const tones = {
  gray: "bg-stone-100 text-stone-700", green: "bg-emerald-100 text-emerald-800", amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800", blue: "bg-sky-100 text-sky-800", purple: "bg-violet-100 text-violet-800",
};
export const Badge = ({ tone = "gray", children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) => (
  <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)}>{children}</span>
);

const statusTone: Record<string, keyof typeof tones> = {
  DRAFT: "gray", SUBMITTED: "amber", APPROVED: "blue", PUBLISHED: "green", NOT_STARTED: "gray", ACTIVE: "green", INACTIVE: "red",
  GRADUATED: "purple", WITHDRAWN: "gray", UNUSED: "green", USED: "blue", EXHAUSTED: "amber", EXPIRED: "red", DISABLED: "red",
  PENDING: "amber", REJECTED: "red", UNDER_REVIEW: "blue", ACCEPTED: "green", ADMITTED: "purple", ARCHIVED: "gray",
};
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={statusTone[status] ?? "gray"}>{status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge>;

export function StatCard({ label, value, icon, hint, tone = "brand" }: { label: string; value: ReactNode; icon?: ReactNode; hint?: string; tone?: "brand" | "accent" | "blue" | "violet" }) {
  const t = { brand: "bg-brand-50 text-brand-700", accent: "bg-accent-50 text-accent-700", blue: "bg-sky-50 text-sky-700", violet: "bg-violet-50 text-violet-700" }[tone];
  return (
    <div className="card flex items-center gap-4 p-5">
      {icon && <div className={cn("grid size-12 shrink-0 place-items-center rounded-xl", t)}>{icon}</div>}
      <div className="min-w-0">
        <div className="text-2xl font-bold leading-tight tabular-nums">{value}</div>
        <div className="truncate text-sm text-muted">{label}</div>
        {hint && <div className="text-xs text-muted/80">{hint}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- forms

export function Field({ label, error, hint, children, required, className }: { label: string; error?: string | null; hint?: string; children: ReactNode; required?: boolean; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="field-label">{label}{required && <span className="text-red-600"> *</span>}</label>
      <div id={id}>{children}</div>
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p className="mt-1 text-xs font-medium text-red-600" role="alert">{error}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn("input", className)} {...p} />);
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, rows = 4, ...p }, ref) => <textarea ref={ref} rows={rows} className={cn("input", className)} {...p} />);
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => <select ref={ref} className={cn("input pr-8", className)} {...p}>{children}</select>);

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-3 text-sm", disabled && "opacity-50")}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn("relative h-6 w-11 shrink-0 rounded-full transition", checked ? "bg-brand-600" : "bg-stone-300")}>
        <span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition", checked && "translate-x-5")} />
      </button>
      <span>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------- feedback / states

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cn("size-5 animate-spin text-brand-600", className)} aria-label="Loading" />;
export const Skeleton = ({ className }: { className?: string }) => <div className={cn("skeleton rounded-lg", className)} />;

export function PageLoader({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">{icon ?? <Inbox className="size-7" />}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="alert">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-red-50 text-red-600"><AlertTriangle className="size-7" /></div>
      <h3 className="text-lg font-semibold">We couldn’t load this</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>
      {onRetry && <Button variant="outline" className="mt-5" onClick={onRetry}><RefreshCw className="size-4" /> Try again</Button>}
    </div>
  );
}

export function Alert({ tone = "info", children, className }: { tone?: "info" | "warn" | "error" | "success"; children: ReactNode; className?: string }) {
  const t = { info: "border-sky-200 bg-sky-50 text-sky-900", warn: "border-amber-200 bg-amber-50 text-amber-900", error: "border-red-200 bg-red-50 text-red-900", success: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  return <div role={tone === "error" ? "alert" : undefined} className={cn("rounded-xl border px-4 py-3 text-sm", t, className)}>{children}</div>;
}

/** Renders loading / error / empty / content for a fetch result. */
export function Async({ loading, error, onRetry, empty, emptyNode, children, rows }: { loading: boolean; error: string | null; onRetry?: () => void; empty?: boolean; emptyNode?: ReactNode; children: ReactNode; rows?: number }) {
  if (loading) return <div className="p-5"><PageLoader rows={rows} /></div>;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (empty) return <>{emptyNode ?? <EmptyState title="Nothing here yet" />}</>;
  return <>{children}</>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse">{children}</table></div>;
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="no-print flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
      <span className="text-muted">Page {page} of {pages} · {total} records</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="no-print mb-5 flex gap-1 overflow-x-auto rounded-xl bg-stone-100 p-1" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cn("whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition", value === t.id ? "bg-white text-brand-800 shadow-xs" : "text-muted hover:text-ink")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- modal + confirm

export function Modal({ open, onClose, title, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button:not([data-close])")?.focus();
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return createPortal(
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cn("flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl", w)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button data-close aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-stone-100"><X className="size-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmOpts { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal open={!!state} onClose={() => close(false)} title={state?.title ?? ""} size="sm"
        footer={<><Button variant="outline" onClick={() => close(false)}>Cancel</Button><Button variant={state?.danger ? "danger" : "primary"} onClick={() => close(true)}>{state?.confirmLabel ?? "Confirm"}</Button></>}>
        <div className="text-[15px] text-muted">{state?.message}</div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

export function SearchBox({ value, onChange, placeholder = "Search…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <Input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="max-w-xs" />;
}
