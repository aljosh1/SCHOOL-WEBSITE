export type Rec = Record<string, any>;
export interface Paged<T = Rec> { items: T[]; total: number; page: number; page_size: number }

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const TOKEN_KEY = "sp_token";

export const tokenStore = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (t: string) => sessionStorage.setItem(TOKEN_KEY, t),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const apiUrl = (path: string) => `${BASE}${path}`;

type Params = Record<string, string | number | boolean | null | undefined>;
export function qs(params?: Params) {
  if (!params) return "";
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== false) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

interface Opts { method?: string; body?: unknown; form?: FormData; params?: Params; auth?: boolean; signal?: AbortSignal }

async function request(path: string, o: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token && o.auth !== false) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (o.form) body = o.form;
  else if (o.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(o.body);
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path) + qs(o.params), { method: o.method ?? (body ? "POST" : "GET"), headers, body, signal: o.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Cannot reach the server. Check your internet connection and try again.");
  }
  if (!res.ok) {
    let msg = res.status === 429 ? "Too many requests. Please slow down and try again shortly." : "Something went wrong. Please try again.";
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
    } catch { /* non-JSON error body */ }
    if (res.status === 401 && o.auth !== false && !path.startsWith("/api/auth/login")) {
      tokenStore.clear();
      window.dispatchEvent(new Event("auth:expired"));
    }
    throw new ApiError(res.status, msg);
  }
  return res;
}

export async function api<T = Rec>(path: string, o: Opts = {}): Promise<T> {
  const res = await request(path, o);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T = Rec>(path: string, params?: Params, signal?: AbortSignal) => api<T>(path, { params, signal });
export const post = <T = Rec>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body ?? {} });
export const put = <T = Rec>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body: body ?? {} });
export const del = (path: string) => api<void>(path, { method: "DELETE" });
export const upload = <T = Rec>(path: string, form: FormData, method = "POST") => api<T>(path, { method, form });

export async function fetchBlob(path: string, params?: Params, auth = true): Promise<{ blob: Blob; filename?: string }> {
  const res = await request(path, { params, auth });
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename="?([^";]+)"?/.exec(cd);
  return { blob: await res.blob(), filename: m?.[1] };
}

export async function saveFile(path: string, fallbackName: string, params?: Params, auth = true) {
  const { blob, filename } = await fetchBlob(path, params, auth);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? fallbackName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function postForFile(path: string, body: unknown, fallbackName: string) {
  const res = await request(path, { method: "POST", body });
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = fallbackName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function openFile(path: string, params?: Params, auth = true) {
  const win = window.open("", "_blank");
  try {
    const { blob } = await fetchBlob(path, params, auth);
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win?.close();
    throw e;
  }
}
