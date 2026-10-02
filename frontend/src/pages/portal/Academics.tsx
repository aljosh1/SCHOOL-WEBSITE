import { useEffect, useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { del, get, post, put, type Rec } from "@/lib/api";
import { useFetch, useToast } from "@/lib/hooks";
import { fmtDate, nullify } from "@/lib/utils";
import { Alert, Async, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Switch, TableWrap, Tabs, useConfirm } from "@/components/ui";

type Tab = "sessions" | "classes" | "subjects" | "grading";

export default function Academics() {
  const [tab, setTab] = useState<Tab>("sessions");
  return (
    <>
      <PageHeader title="Sessions, classes & subjects" description="Define your academic calendar, class structure, subjects and grading scale." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "sessions", label: "Sessions & terms" }, { id: "classes", label: "Classes & arms" }, { id: "subjects", label: "Subjects" }, { id: "grading", label: "Grading scale" }]} />
      {tab === "sessions" && <Sessions />}
      {tab === "classes" && <Classes />}
      {tab === "subjects" && <Subjects />}
      {tab === "grading" && <Grading />}
    </>
  );
}

function useAction() {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    try { await fn(); toast.success(ok); after?.(); } catch (e) { toast.error((e as Error).message); }
  };
}

// ------------------------------------------------------------------ sessions

function Sessions() {
  const { data, loading, error, reload } = useFetch(() => get<Rec[]>("/api/sessions"), []);
  const [session, setSession] = useState<{ open: boolean }>({ open: false });
  const [term, setTerm] = useState<{ sessionId: number; term: Rec | null } | null>(null);
  const confirm = useConfirm();
  const act = useAction();

  return (
    <>
      <div className="mb-4 flex justify-end"><Button size="sm" onClick={() => setSession({ open: true })}><Plus className="size-4" /> New session</Button></div>
      <Async loading={loading} error={error} onRetry={reload} empty={!data?.length} emptyNode={<Card><EmptyState title="No sessions yet" description="Create your first academic session, e.g. 2026/2027." action={<Button onClick={() => setSession({ open: true })}>Create session</Button>} /></Card>}>
        <div className="space-y-5">
          {data?.map((s) => (
            <Card key={s.id}>
              <CardHeader title={<span className="flex items-center gap-2">{s.name}{s.is_current && <Badge tone="green">Current</Badge>}</span>} description={s.start_date ? `${fmtDate(s.start_date)} – ${fmtDate(s.end_date)}` : undefined}
                action={<div className="flex gap-2">
                  {!s.is_current && <Button size="sm" variant="outline" onClick={async () => (await confirm({ title: "Make this the current session?", message: "New results, codes and materials default to the current session." })) && act(() => post(`/api/sessions/${s.id}/set-current`), "Current session updated", reload)}>Set current</Button>}
                  <Button size="sm" variant="outline" onClick={() => setTerm({ sessionId: s.id, term: null })}><Plus className="size-4" /> Term</Button>
                  {!s.is_current && <Button size="sm" variant="ghost" aria-label="Delete session" onClick={async () => (await confirm({ title: `Delete ${s.name}?`, message: "This only works if the session has no students, results or other records.", confirmLabel: "Delete", danger: true })) && act(() => del(`/api/sessions/${s.id}`), "Session deleted", reload)}><Trash2 className="size-4 text-red-600" /></Button>}
                </div>} />
              <TableWrap>
                <thead className="bg-stone-50"><tr><th className="th">#</th><th className="th">Term</th><th className="th">Dates</th><th className="th">Next term begins</th><th className="th" /></tr></thead>
                <tbody>
                  {s.terms.map((t: Rec) => (
                    <tr key={t.id} className="border-t border-line">
                      <td className="td">{t.position}</td><td className="td font-semibold">{t.name} {t.is_current && <Badge tone="green" className="ml-1">Current</Badge>}</td>
                      <td className="td">{t.start_date ? `${fmtDate(t.start_date)} – ${fmtDate(t.end_date)}` : "—"}</td><td className="td">{fmtDate(t.next_term_begins)}</td>
                      <td className="td text-right"><div className="flex justify-end gap-1">
                        {!t.is_current && <Button size="sm" variant="ghost" title="Set as current term" onClick={() => act(() => post(`/api/terms/${t.id}/set-current`), "Current term updated", reload)}><Check className="size-4" /> Current</Button>}
                        <Button size="sm" variant="ghost" aria-label="Edit term" onClick={() => setTerm({ sessionId: s.id, term: t })}><Pencil className="size-4" /></Button>
                        {!t.is_current && <Button size="sm" variant="ghost" aria-label="Delete term" onClick={async () => (await confirm({ title: `Delete ${t.name}?`, message: "Only terms without results can be deleted.", confirmLabel: "Delete", danger: true })) && act(() => del(`/api/terms/${t.id}`), "Term deleted", reload)}><Trash2 className="size-4 text-red-600" /></Button>}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </Card>
          ))}
        </div>
      </Async>
      <SessionModal open={session.open} onClose={() => setSession({ open: false })} onSaved={reload} />
      <TermModal ctx={term} onClose={() => setTerm(null)} onSaved={reload} />
    </>
  );
}

function SessionModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: "", start_date: "", end_date: "", create_default_terms: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => { if (open) { setError(null); setF({ name: "", start_date: "", end_date: "", create_default_terms: true }); } }, [open]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await post("/api/sessions", nullify(f)); toast.success("Session created"); onSaved(); onClose(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="New academic session" size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="session-form" loading={busy}>Create</Button></>}>
      <form id="session-form" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Session name" required hint="Format 2026/2027"><Input required pattern="\d{4}/\d{4}" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="2026/2027" /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Starts"><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field><Field label="Ends"><Input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field></div>
        <Switch checked={f.create_default_terms} onChange={(v) => setF({ ...f, create_default_terms: v })} label="Create First, Second and Third Term" />
      </form>
    </Modal>
  );
}

function TermModal({ ctx, onClose, onSaved }: { ctx: { sessionId: number; term: Rec | null } | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Rec>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => { if (ctx) { setError(null); setF({ name: ctx.term?.name ?? "", position: ctx.term?.position ?? "", start_date: ctx.term?.start_date ?? "", end_date: ctx.term?.end_date ?? "", next_term_begins: ctx.term?.next_term_begins ?? "" }); } }, [ctx]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = nullify({ ...f, position: Number(f.position) });
      ctx!.term ? await put(`/api/terms/${ctx!.term.id}`, body) : await post(`/api/sessions/${ctx!.sessionId}/terms`, body);
      toast.success("Term saved"); onSaved(); onClose();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open={!!ctx} onClose={onClose} title={ctx?.term ? "Edit term" : "Add term"} size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="term-form" loading={busy}>Save</Button></>}>
      <form id="term-form" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid grid-cols-[1fr_6rem] gap-3"><Field label="Name" required><Input required value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Order" required><Input required type="number" min={1} max={6} value={f.position ?? ""} onChange={(e) => setF({ ...f, position: e.target.value })} /></Field></div>
        <div className="grid grid-cols-2 gap-3"><Field label="Starts"><Input type="date" value={f.start_date ?? ""} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field><Field label="Ends"><Input type="date" value={f.end_date ?? ""} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field></div>
        <Field label="Next term begins" hint="Shown on the report card"><Input type="date" value={f.next_term_begins ?? ""} onChange={(e) => setF({ ...f, next_term_begins: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ classes

function Classes() {
  const { data, loading, error, reload } = useFetch(() => get<Rec[]>("/api/classes"), []);
  const teachers = useFetch(() => get<{ items: Rec[] }>("/api/teachers", { page_size: 200 }), []);
  const [cls, setCls] = useState<{ open: boolean; item: Rec | null }>({ open: false, item: null });
  const [arm, setArm] = useState<{ classId: number; item: Rec | null } | null>(null);
  const confirm = useConfirm();
  const act = useAction();

  return (
    <>
      <div className="mb-4 flex justify-end"><Button size="sm" onClick={() => setCls({ open: true, item: null })}><Plus className="size-4" /> New class</Button></div>
      <Async loading={loading} error={error} onRetry={reload} empty={!data?.length} emptyNode={<Card><EmptyState title="No classes yet" description="Add classes such as JSS 1 … SS 3, then give each class its arms (A, B, Gold…)." action={<Button onClick={() => setCls({ open: true, item: null })}>Add class</Button>} /></Card>}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex items-start justify-between"><div><h3 className="text-xl font-semibold">{c.name}</h3><div className="text-xs text-muted">Level order {c.level_order}</div></div>
                <div className="flex"><Button size="sm" variant="ghost" aria-label="Edit class" onClick={() => setCls({ open: true, item: c })}><Pencil className="size-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Delete class" onClick={async () => (await confirm({ title: `Delete ${c.name}?`, message: "Only classes without students or records can be deleted.", confirmLabel: "Delete", danger: true })) && act(() => del(`/api/classes/${c.id}`), "Class deleted", reload)}><Trash2 className="size-4 text-red-600" /></Button></div></div>
              <div className="mt-4 space-y-2">
                {c.arms.length === 0 && <p className="text-sm text-muted">No arms yet.</p>}
                {c.arms.map((a: Rec) => (
                  <div key={a.id} className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm"><div><b>Arm {a.name}</b><span className="ml-2 text-muted">{a.form_teacher ? `Form teacher: ${a.form_teacher}` : "No form teacher"}</span></div>
                    <div className="flex"><Button size="sm" variant="ghost" aria-label="Edit arm" onClick={() => setArm({ classId: c.id, item: a })}><Pencil className="size-3.5" /></Button>
                      <Button size="sm" variant="ghost" aria-label="Delete arm" onClick={async () => (await confirm({ title: `Delete arm ${a.name}?`, message: "Only arms without students can be deleted.", confirmLabel: "Delete", danger: true })) && act(() => del(`/api/arms/${a.id}`), "Arm deleted", reload)}><Trash2 className="size-3.5 text-red-600" /></Button></div></div>
                ))}
                <Button size="sm" variant="soft" onClick={() => setArm({ classId: c.id, item: null })}><Plus className="size-4" /> Add arm</Button>
              </div>
            </Card>
          ))}
        </div>
      </Async>
      <ClassModal state={cls} onClose={() => setCls({ open: false, item: null })} onSaved={reload} />
      <ArmModal ctx={arm} teachers={teachers.data?.items ?? []} onClose={() => setArm(null)} onSaved={reload} />
    </>
  );
}

function ClassModal({ state, onClose, onSaved }: { state: { open: boolean; item: Rec | null }; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: "", level_order: "0" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (state.open) { setError(null); setF({ name: state.item?.name ?? "", level_order: String(state.item?.level_order ?? 0) }); } }, [state]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: f.name, level_order: Number(f.level_order) };
      state.item ? await put(`/api/classes/${state.item.id}`, body) : await post("/api/classes", body);
      toast.success("Class saved"); onSaved(); onClose();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open={state.open} onClose={onClose} title={state.item ? "Edit class" : "New class"} size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="class-form" loading={busy}>Save</Button></>}>
      <form id="class-form" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Class name" required><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="JSS 1" /></Field>
        <Field label="Level order" hint="Used for sorting (1 = lowest)"><Input type="number" min={0} value={f.level_order} onChange={(e) => setF({ ...f, level_order: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

function ArmModal({ ctx, teachers, onClose, onSaved }: { ctx: { classId: number; item: Rec | null } | null; teachers: Rec[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [ft, setFt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (ctx) { setError(null); setName(ctx.item?.name ?? ""); setFt(ctx.item?.form_teacher_id ? String(ctx.item.form_teacher_id) : ""); } }, [ctx]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name, form_teacher_id: ft ? Number(ft) : null };
      ctx!.item ? await put(`/api/arms/${ctx!.item.id}`, body) : await post(`/api/classes/${ctx!.classId}/arms`, body);
      toast.success("Arm saved"); onSaved(); onClose();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open={!!ctx} onClose={onClose} title={ctx?.item ? "Edit arm" : "Add arm"} size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="arm-form" loading={busy}>Save</Button></>}>
      <form id="arm-form" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Arm name" required><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="A" /></Field>
        <Field label="Form teacher" hint="Can edit report-card remarks for this arm"><select className="input" value={ft} onChange={(e) => setFt(e.target.value)}><option value="">None</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></Field>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ subjects

function Subjects() {
  const { data, loading, error, reload } = useFetch(() => get<Rec[]>("/api/subjects"), []);
  const [m, setM] = useState<{ open: boolean; item: Rec | null }>({ open: false, item: null });
  const confirm = useConfirm();
  const act = useAction();
  return (
    <>
      <div className="mb-4 flex justify-end"><Button size="sm" onClick={() => setM({ open: true, item: null })}><Plus className="size-4" /> New subject</Button></div>
      <Card>
        <Async loading={loading} error={error} onRetry={reload} empty={!data?.length} emptyNode={<EmptyState title="No subjects yet" description="Add subjects such as Mathematics and English Language." action={<Button onClick={() => setM({ open: true, item: null })}>Add subject</Button>} />}>
          <TableWrap>
            <thead className="bg-stone-50"><tr><th className="th">Subject</th><th className="th">Code</th><th className="th">Category</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>{data?.map((s) => (
              <tr key={s.id} className="border-t border-line"><td className="td font-semibold">{s.name}</td><td className="td font-mono text-xs">{s.code}</td><td className="td">{s.category ?? "—"}</td><td className="td">{s.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                <td className="td text-right"><Button size="sm" variant="ghost" aria-label="Edit subject" onClick={() => setM({ open: true, item: s })}><Pencil className="size-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Delete subject" onClick={async () => (await confirm({ title: `Delete ${s.name}?`, message: "Subjects with results or materials cannot be deleted; deactivate them instead.", confirmLabel: "Delete", danger: true })) && act(() => del(`/api/subjects/${s.id}`), "Subject deleted", reload)}><Trash2 className="size-4 text-red-600" /></Button></td></tr>
            ))}</tbody>
          </TableWrap>
        </Async>
      </Card>
      <SubjectModal state={m} onClose={() => setM({ open: false, item: null })} onSaved={reload} />
    </>
  );
}

function SubjectModal({ state, onClose, onSaved }: { state: { open: boolean; item: Rec | null }; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Rec>({ name: "", code: "", category: "", is_active: true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (state.open) { setError(null); setF({ name: state.item?.name ?? "", code: state.item?.code ?? "", category: state.item?.category ?? "", is_active: state.item?.is_active ?? true }); } }, [state]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { const body = nullify(f); state.item ? await put(`/api/subjects/${state.item.id}`, body) : await post("/api/subjects", body); toast.success("Subject saved"); onSaved(); onClose(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open={state.open} onClose={onClose} title={state.item ? "Edit subject" : "New subject"} size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="subject-form" loading={busy}>Save</Button></>}>
      <form id="subject-form" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Subject name" required><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Code" required><Input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={20} /></Field><Field label="Category"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field></div>
        <Switch checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Active" />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ grading

const STANDARD = [
  ["A", "Excellent", 70, 100, 5], ["B", "Very Good", 60, 69, 4], ["C", "Good", 50, 59, 3], ["D", "Pass", 45, 49, 2], ["E", "Weak Pass", 40, 44, 1], ["F", "Fail", 0, 39, 0],
].map(([grade, description, min_score, max_score, grade_point]) => ({ grade, description, min_score, max_score, grade_point, remark: "", principal_remark: "" }));

function Grading() {
  const { data, loading, error, reload } = useFetch(() => get<Rec>("/api/grading-scale"), []);
  const [rows, setRows] = useState<Rec[]>([]);
  const [name, setName] = useState("Custom");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  useEffect(() => { if (data) { setName(data.name ?? "Custom"); setRows([...data.entries].sort((a: Rec, b: Rec) => b.min_score - a.min_score).map((e: Rec) => ({ ...e, remark: e.remark ?? "", principal_remark: e.principal_remark ?? "" }))); } }, [data]);
  const upd = (i: number, k: string, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  async function save() {
    if (!(await confirm({ title: "Save grading scale?", message: "Results that are not yet published will be recalculated. Published results keep the grade they were published with." }))) return;
    setBusy(true);
    setErr(null);
    try {
      await put("/api/grading-scale", { name, entries: rows.map((r) => ({ ...nullify(r), min_score: Number(r.min_score), max_score: Number(r.max_score), grade_point: Number(r.grade_point) })) });
      toast.success("Grading scale saved");
      reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader title="Grading scale" description={data ? `Scores are out of ${data.ca_max + data.exam_max} (CA ${data.ca_max} + Exam ${data.exam_max}). Bands must start at 0, not overlap, and reach ${data.ca_max + data.exam_max}.` : undefined}
        action={<Button size="sm" variant="outline" onClick={() => setRows(STANDARD.map((r) => ({ ...r })))}>Load standard A–F</Button>} />
      <Async loading={loading} error={error} onRetry={reload}>
        <div className="space-y-4 p-5">
          {err && <Alert tone="error">{err}</Alert>}
          <Field label="Scale name" className="max-w-xs"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr><th className="th">Grade</th><th className="th">Description</th><th className="th">Min</th><th className="th">Max</th><th className="th">Point</th><th className="th">Teacher remark</th><th className="th">Principal remark</th><th className="th" /></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i} className="border-t border-line align-top">
                  <td className="p-1.5"><Input className="w-16" aria-label="Grade" value={r.grade} onChange={(e) => upd(i, "grade", e.target.value.toUpperCase())} maxLength={5} /></td>
                  <td className="p-1.5"><Input aria-label="Description" value={r.description} onChange={(e) => upd(i, "description", e.target.value)} /></td>
                  <td className="p-1.5"><Input className="w-20" type="number" min={0} aria-label="Minimum score" value={r.min_score} onChange={(e) => upd(i, "min_score", e.target.value)} /></td>
                  <td className="p-1.5"><Input className="w-20" type="number" min={0} aria-label="Maximum score" value={r.max_score} onChange={(e) => upd(i, "max_score", e.target.value)} /></td>
                  <td className="p-1.5"><Input className="w-20" type="number" step="0.1" min={0} aria-label="Grade point" value={r.grade_point} onChange={(e) => upd(i, "grade_point", e.target.value)} /></td>
                  <td className="p-1.5"><Input aria-label="Teacher remark" value={r.remark} onChange={(e) => upd(i, "remark", e.target.value)} /></td>
                  <td className="p-1.5"><Input aria-label="Principal remark" value={r.principal_remark} onChange={(e) => upd(i, "principal_remark", e.target.value)} /></td>
                  <td className="p-1.5"><Button size="sm" variant="ghost" aria-label="Remove band" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="size-4 text-red-600" /></Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => setRows([...rows, { grade: "", description: "", min_score: "", max_score: "", grade_point: "0", remark: "", principal_remark: "" }])}><Plus className="size-4" /> Add band</Button><Button onClick={save} loading={busy}>Save grading scale</Button></div>
        </div>
      </Async>
    </Card>
  );
}
