import { useState } from "react";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { get, post, type Rec } from "@/lib/api";
import { useFetch, useToast } from "@/lib/hooks";
import { faqs, process, requirements } from "@/content";
import { nullify, fmtDate } from "@/lib/utils";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { SectionTitle } from "./Home";
import { PageBanner } from "./About";

const empty = { first_name: "", middle_name: "", last_name: "", date_of_birth: "", gender: "", class_applied_id: "", previous_school: "", address: "", state_of_origin: "", medical_notes: "", guardian_name: "", guardian_relationship: "", guardian_phone: "", guardian_email: "" };

export default function Admissions() {
  const classes = useFetch(() => get<Rec[]>("/api/public/classes"), []);
  const sessions = useFetch(() => get<Rec[]>("/api/public/sessions"), []);
  const toast = useToast();
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(0);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const current = sessions.data?.find((s) => s.is_current);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post<Rec>("/api/public/applications", nullify({ ...form, class_applied_id: Number(form.class_applied_id) }));
      setDone(res.reference);
      toast.success("Application submitted");
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <PageBanner title="Admissions" text="Join a school that is organised, safe and focused on your child's success." />
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-6 lg:col-span-1">
            <h2 className="text-2xl font-semibold">Admission information</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">We admit students into the classes listed below at the start of each session, and into other classes as places become available. Parents or guardians apply on behalf of the child.</p>
            <h3 className="mt-6 text-lg font-semibold">Available classes</h3>
            <div className="mt-2 flex flex-wrap gap-2">{classes.data?.map((c) => <span key={c.id} className="rounded-full bg-brand-50 px-3.5 py-1 text-sm font-semibold text-brand-800">{c.name}</span>) ?? <span className="text-sm text-muted">Loading…</span>}</div>
          </Card>
          <Card className="p-6">
            <h2 className="text-2xl font-semibold">Requirements</h2>
            <ul className="mt-3 space-y-2.5 text-[15px]">{requirements.map((r) => <li key={r} className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-600" />{r}</li>)}</ul>
          </Card>
          <Card className="p-6">
            <h2 className="text-2xl font-semibold">Important dates</h2>
            {current?.terms?.some((t: Rec) => t.start_date || t.next_term_begins) ? (
              <ul className="mt-3 space-y-2.5 text-[15px]">{current.terms.map((t: Rec) => <li key={t.id}><b>{t.name}</b>: {t.start_date ? `begins ${fmtDate(t.start_date)}` : "date to be announced"}{t.end_date ? `, ends ${fmtDate(t.end_date)}` : ""}</li>)}</ul>
            ) : <p className="mt-3 text-[15px] text-muted">Term dates and entrance-assessment dates are published on the News page and by the admissions office.</p>}
          </Card>
        </div>

        <div className="mt-16">
          <SectionTitle kicker="How it works" title="Application process" />
          <ol className="grid gap-4 md:grid-cols-4">
            {process.map((p, i) => (
              <li key={p.title} className="rounded-2xl border border-line bg-white p-5"><div className="mb-3 grid size-10 place-items-center rounded-full bg-accent-600 font-display text-lg font-bold text-white">{i + 1}</div><h3 className="font-semibold">{p.title}</h3><p className="mt-1 text-sm text-muted">{p.text}</p></li>
            ))}
          </ol>
        </div>

        <div className="mt-16 grid gap-10 lg:grid-cols-[1.4fr_1fr]" id="apply">
          <div>
            <h2 className="mb-1 text-3xl font-semibold text-brand-900">Online application</h2>
            <p className="mb-6 text-muted">Fields marked * are required.</p>
            {done ? (
              <Card className="p-8 text-center">
                <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="size-8" /></div>
                <h3 className="text-2xl font-semibold">Application received</h3>
                <p className="mt-2 text-muted">Your reference number is</p>
                <div className="mx-auto mt-2 inline-block rounded-xl bg-brand-50 px-6 py-3 font-mono text-2xl font-bold text-brand-800">{done}</div>
                <p className="mt-4 text-sm text-muted">Please keep it safe. The admissions office will contact the guardian using the details supplied.</p>
                <Button className="mt-6" variant="outline" onClick={() => { setDone(null); setForm(empty); }}>Submit another application</Button>
              </Card>
            ) : (
              <form onSubmit={submit} className="card space-y-8 p-6">
                {error && <Alert tone="error">{error}</Alert>}
                <fieldset className="grid gap-4 sm:grid-cols-2">
                  <legend className="mb-3 font-display text-xl font-semibold">Student</legend>
                  <Field label="First name" required><Input required value={form.first_name} onChange={set("first_name")} autoComplete="given-name" /></Field>
                  <Field label="Last name" required><Input required value={form.last_name} onChange={set("last_name")} /></Field>
                  <Field label="Middle name"><Input value={form.middle_name} onChange={set("middle_name")} /></Field>
                  <Field label="Date of birth" required><Input type="date" required value={form.date_of_birth} onChange={set("date_of_birth")} max={new Date().toISOString().slice(0, 10)} /></Field>
                  <Field label="Gender" required><Select required value={form.gender} onChange={set("gender")}><option value="">Select…</option><option value="MALE">Male</option><option value="FEMALE">Female</option></Select></Field>
                  <Field label="Class applying for" required><Select required value={form.class_applied_id} onChange={set("class_applied_id")}><option value="">Select…</option>{classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
                  <Field label="Previous school"><Input value={form.previous_school} onChange={set("previous_school")} /></Field>
                  <Field label="State of origin"><Input value={form.state_of_origin} onChange={set("state_of_origin")} /></Field>
                  <Field label="Home address" required className="sm:col-span-2"><Textarea rows={2} required minLength={5} value={form.address} onChange={set("address")} autoComplete="street-address" /></Field>
                  <Field label="Medical conditions or allergies" className="sm:col-span-2"><Textarea rows={2} value={form.medical_notes} onChange={set("medical_notes")} /></Field>
                </fieldset>
                <fieldset className="grid gap-4 sm:grid-cols-2">
                  <legend className="mb-3 font-display text-xl font-semibold">Parent / guardian</legend>
                  <Field label="Full name" required><Input required value={form.guardian_name} onChange={set("guardian_name")} /></Field>
                  <Field label="Relationship"><Input value={form.guardian_relationship} onChange={set("guardian_relationship")} placeholder="Mother, Father, Uncle…" /></Field>
                  <Field label="Phone number" required hint="e.g. 08031234567"><Input type="tel" inputMode="tel" required value={form.guardian_phone} onChange={set("guardian_phone")} autoComplete="tel" /></Field>
                  <Field label="Email"><Input type="email" value={form.guardian_email} onChange={set("guardian_email")} autoComplete="email" /></Field>
                </fieldset>
                <Button type="submit" size="lg" loading={busy} className="w-full sm:w-auto">Submit application</Button>
              </form>
            )}
          </div>
          <div>
            <h2 className="mb-6 text-3xl font-semibold text-brand-900">Frequently asked questions</h2>
            <div className="space-y-3">
              {faqs.map((f, i) => (
                <div key={f.q} className="rounded-xl border border-line bg-white">
                  <button className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left font-semibold" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                    {f.q}<ChevronDown className={`size-5 shrink-0 transition ${open === i ? "rotate-180" : ""}`} />
                  </button>
                  {open === i && <p className="px-4 pb-4 text-[15px] leading-relaxed text-muted">{f.a}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
