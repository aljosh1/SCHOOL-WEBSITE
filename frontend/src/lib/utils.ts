import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

export function fmtDate(v?: string | null, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-NG", opts);
}

export function fmtDateTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(v?: string | null) {
  if (!v) return "";
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(v);
}

export const fmtNum = (n?: number | null) => (n === null || n === undefined ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));
export const fmtBytes = (n?: number | null) => (!n ? "—" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Empty strings become null so optional server-side validators (email, phone) accept them. */
export function nullify<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === "string" && v.trim() === "" ? null : v;
  return out as T;
}

export const toIso = (d: string) => (d ? new Date(d).toISOString() : null);

export function csvEscape(v: unknown) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Derives a colour ramp from a base hex colour (treated as the 700 shade). */
export function ramp(hex: string): Record<number, string> {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return {};
  const base = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  const mix = (to: number, t: number) => "#" + base.map((c) => Math.round(c + (to - c) * t).toString(16).padStart(2, "0")).join("");
  return {
    50: mix(255, 0.94), 100: mix(255, 0.87), 200: mix(255, 0.72), 300: mix(255, 0.55), 400: mix(255, 0.33),
    500: mix(255, 0.16), 600: mix(255, 0.06), 700: hex, 800: mix(0, 0.2), 900: mix(0, 0.42),
  };
}

export const gradeColor = (g?: string | null) =>
  ({ A: "bg-emerald-100 text-emerald-800", B: "bg-lime-100 text-lime-800", C: "bg-sky-100 text-sky-800", D: "bg-amber-100 text-amber-800", E: "bg-orange-100 text-orange-800", F: "bg-red-100 text-red-800" })[g ?? ""] ?? "bg-stone-100 text-stone-700";
