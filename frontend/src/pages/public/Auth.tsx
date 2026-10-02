import { useState } from "react";
import { Link, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSchool } from "@/lib/school";
import { Alert, Button, Field, Input } from "@/components/ui";
import { Logo } from "@/components/Layouts";

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-[calc(100dvh-72px)] place-items-center bg-[radial-gradient(70%_60%_at_50%_0%,var(--color-brand-100),transparent)] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Link to="/"><Logo /></Link></div>
        <div className="card p-6 sm:p-8">
          <h1 className="text-3xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

const DEMO = [
  ["Super admin", "superadmin.demo", "Demo@12345"], ["Admin", "admin.demo", "Demo@12345"], ["Teacher", "f.adebayo.demo", "Demo@12345"], ["Student", "STU-2026-0001", "Student@123"],
];

export function Login() {
  const { login } = useAuth();
  const { school } = useSchool();
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(username, password);
      const next = params.get("next") ?? (loc.state as { from?: string } | null)?.from;
      nav(u.must_change_password ? "/portal/account" : next && next.startsWith("/portal") ? next : "/portal", { replace: true });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <Shell title="Sign in" subtitle="Students, parents, teachers and administrators.">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Username or Student ID"><Input required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} className="h-12" /></Field>
        <Field label="Password">
          <div className="relative">
            <Input required type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="h-12 pr-11" />
            <button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-2 text-muted">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
          </div>
        </Field>
        <Button type="submit" size="lg" loading={busy} className="w-full">Sign in</Button>
        <div className="flex justify-between text-sm"><Link to="/forgot-password" className="font-semibold text-brand-700 hover:underline">Forgot password?</Link><Link to="/check-result" className="font-semibold text-brand-700 hover:underline">Check result with a card</Link></div>
      </form>
      {school?.name.includes("DEMO") && (
        <div className="mt-6 rounded-xl border border-dashed border-accent-300 bg-accent-50 p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-accent-700">Demo accounts — demo data only</div>
          <div className="grid grid-cols-2 gap-2">{DEMO.map(([label, u, p]) => <button key={u} type="button" onClick={() => { setUsername(u); setPassword(p); }} className="rounded-lg bg-white px-3 py-2 text-left text-sm font-semibold ring-1 ring-accent-200 hover:ring-accent-500">{label}<span className="block font-mono text-[11px] font-normal text-muted">{u}</span></button>)}</div>
        </div>
      )}
    </Shell>
  );
}

export function ForgotPassword() {
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { setDone((await post<{ message: string }>("/api/auth/forgot-password", { identifier })).message); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Shell title="Reset your password" subtitle="Enter your username or email address and we will send you a reset link.">
      {done ? <Alert tone="success">{done}</Alert> : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Username or email"><Input required value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="h-12" /></Field>
          <Button type="submit" size="lg" loading={busy} className="w-full">Send reset link</Button>
        </form>
      )}
      <p className="mt-5 text-sm text-muted">Students without an email address should ask the school office to reset the password.</p>
      <Link to="/login" className="mt-3 block text-sm font-semibold text-brand-700 hover:underline">Back to sign in</Link>
    </Shell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await post("/api/auth/reset-password", { token: params.get("token") ?? "", new_password: pw }); setOk(true); setTimeout(() => nav("/login"), 2000); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Shell title="Choose a new password">
      {ok ? <Alert tone="success">Password updated. Redirecting to sign in…</Alert> : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="New password" hint="At least 8 characters with letters and numbers."><Input required type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" className="h-12" /></Field>
          <Button type="submit" size="lg" loading={busy} className="w-full">Update password</Button>
        </form>
      )}
    </Shell>
  );
}
