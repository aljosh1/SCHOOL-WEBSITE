import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Lock, Printer, RotateCcw, ShieldCheck } from "lucide-react";
import { get, post, saveFile, type Rec } from "@/lib/api";
import { useFetch, useToast } from "@/lib/hooks";
import { useSchool } from "@/lib/school";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { ResultSheet } from "@/components/ResultSheet";

export default function CheckResult() {
  const { school } = useSchool();
  const sessions = useFetch(() => get<Rec[]>("/api/public/sessions"), []);
  const toast = useToast();
  const [ref, setRef] = useState("");
  const [pin, setPin] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [termId, setTermId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Rec | null>(null);

  useEffect(() => {
    const list = sessions.data;
    if (!list?.length || sessionId) return;
    const cur = list.find((s) => s.is_current) ?? list[0];
    setSessionId(String(cur.id));
    setTermId(String((cur.terms.find((t: Rec) => t.is_current) ?? cur.terms[0])?.id ?? ""));
  }, [sessions.data, sessionId]);

  const terms: Rec[] = sessions.data?.find((s) => String(s.id) === sessionId)?.terms ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post<Rec>("/api/results/check", { student_ref: ref, code: pin, session_id: Number(sessionId), term_id: Number(termId) });
      setResult(res);
      setPin("");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function download() {
    try { await saveFile("/api/results/check/pdf", "result.pdf", { token: result!.pdf_token }, false); }
    catch (e) { toast.error((e as Error).message); }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-5xl px-3 py-6 sm:px-6 sm:py-10">
        <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">Your result</h1>
            <p className="text-sm text-muted">This card has {result.uses_remaining} use{result.uses_remaining === 1 ? "" : "s"} remaining.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
            <Button onClick={download}><Download className="size-4" /> Download PDF</Button>
            <Button variant="ghost" onClick={() => { setResult(null); setRef(""); }}><RotateCcw className="size-4" /> Check another</Button>
          </div>
        </div>
        <ResultSheet report={result.report} school={result.school} photoSrc={result.report.student.photo} />
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:py-16">
      <div className="lg:pt-6">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-800"><ShieldCheck className="size-4" /> Secure result portal</div>
        <h1 className="text-4xl font-semibold leading-tight text-brand-900 sm:text-5xl">Check your result</h1>
        <p className="mt-4 max-w-md text-lg text-muted">Enter the student's ID and the PIN printed on your result-checking card for {school?.name ?? "the school"}.</p>
        <ol className="mt-8 space-y-4 text-[15px]">
          {["Enter the Student ID (or admission number).", "Enter the access PIN from your scratch card.", "Select the session and term.", "View, print or download the result."].map((t, i) => (
            <li key={t} className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-600 text-sm font-bold text-white">{i + 1}</span><span className="pt-0.5">{t}</span></li>
          ))}
        </ol>
        <p className="mt-8 text-sm text-muted">Don't have a card? Please contact the school office. Already have a student account? <Link to="/login" className="font-semibold text-brand-700 underline">Sign in to the portal</Link>.</p>
      </div>

      <form onSubmit={submit} className="card space-y-5 p-5 sm:p-8" aria-label="Check result form">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Student ID or admission number" required>
          <Input required value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} placeholder="e.g. STU-2026-0001" autoCapitalize="characters" autoComplete="off" spellCheck={false} className="h-12 font-mono text-base" />
        </Field>
        <Field label="Result access PIN" required>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input required value={pin} onChange={(e) => setPin(e.target.value.toUpperCase())} placeholder="SCH-XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" spellCheck={false} className="h-12 pl-10 font-mono text-base tracking-wider" />
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Session" required>
            <Select required value={sessionId} onChange={(e) => { setSessionId(e.target.value); setTermId(String(sessions.data?.find((s) => String(s.id) === e.target.value)?.terms[0]?.id ?? "")); }} className="h-12">
              {sessions.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Term" required>
            <Select required value={termId} onChange={(e) => setTermId(e.target.value)} className="h-12">{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          </Field>
        </div>
        {sessions.error && <Alert tone="error">{sessions.error}</Alert>}
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!sessionId || !termId}>Check Result</Button>
        <p className="text-center text-xs text-muted">For your security, repeated incorrect attempts will temporarily block further checks.</p>
      </form>
    </div>
  );
}
