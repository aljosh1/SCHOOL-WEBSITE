import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download, GraduationCap, Plus, Printer, TrendingUp } from "lucide-react";
import { get, post, put, saveFile, type Paged, type Rec } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced, useFetch, useToast } from "@/lib/hooks";
import { useLookups } from "@/lib/lookups";
import { nullify } from "@/lib/utils";
import { Alert, Async, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, StatusBadge, TableWrap, Textarea } from "@/components/ui";

export const EMPTY_STUDENT = {
  first_name: "", middle_name: "", last_name: "", date_of_birth: "", gender: "", class_id: "", arm_id: "", admission_no: "", admission_date: "", status: "ACTIVE",
  state_of_origin: "", religion: "", blood_group: "", previous_school: "", address: "", medical_notes: "",
  parent_name: "", parent_relationship: "", parent_phone: "", parent_email: "", parent_address: "", parent_occupation: "",
  emergency_name: "", emergency_phone: "", emergency_relationship: "",
};

export function StudentFormModal({ open, onClose, student, onSaved }: { open: boolean; onClose: () => void; student?: Rec | null; onSaved: (s: Rec) => void }) {
  const { classes } = useLookups();
  const toast = useToast();
  const [f, setF] = useState<Rec>(EMPTY_STUDENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<Rec | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setF(student ? Object.fromEntries(Object.keys(EMPTY_STUDENT).map((k) => [k, student[k] ?? ""])) : EMPTY_STUDENT);
  }, [open, student]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value, ...(k === "class_id" ? { arm_id: "" } : {}) });
  const arms: Rec[] = classes.find((c) => String(c.id) === String(f.class_id))?.arms ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = nullify({ ...f, class_id: f.class_id ? Number(f.class_id) : null, arm_id: f.arm_id ? Number(f.arm_id) : null, status: student ? f.status : undefined });
      const res = student ? await put<Rec>(`/api/students/${student.id}`, body) : await post<Rec>("/api/students", body);
      toast.success(student ? "Student updated" : "Student registered");
      onSaved(res);
      if (res.credentials) setCreds(res.credentials); else onClose();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  if (creds) {
    return (
      <Modal open onClose={() => { setCreds(null); onClose(); }} title="Student registered" size="sm" footer={<Button onClick={() => { setCreds(null); onClose(); }}>Done</Button>}>
        <Alert tone="warn">Copy these login details now. The temporary password is shown only once.</Alert>
        <dl className="mt-4 space-y-3 rounded-xl bg-stone-50 p-4 text-sm">
          <div><dt className="text-muted">Username (Student ID)</dt><dd className="font-mono text-lg font-bold">{creds.username}</dd></div>
          <div><dt className="text-muted">Temporary password</dt><dd className="font-mono text-lg font-bold">{creds.temporary_password}</dd></div>
        </dl>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={student ? "Edit student" : "Register student"} size="xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="student-form" loading={busy}>{student ? "Save changes" : "Register student"}</Button></>}>
      <form id="student-form" onSubmit={submit} className="space-y-8">
        {error && <Alert tone="error">{error}</Alert>}
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-3 font-display text-lg font-semibold">Student</legend>
          <Field label="First name" required><Input required value={f.first_name} onChange={set("first_name")} /></Field>
          <Field label="Middle name"><Input value={f.middle_name} onChange={set("middle_name")} /></Field>
          <Field label="Last name" required><Input required value={f.last_name} onChange={set("last_name")} /></Field>
          <Field label="Date of birth"><Input type="date" value={f.date_of_birth} onChange={set("date_of_birth")} /></Field>
          <Field label="Gender"><Select value={f.gender} onChange={set("gender")}><option value="">Select…</option><option value="MALE">Male</option><option value="FEMALE">Female</option></Select></Field>
          <Field label="Admission date"><Input type="date" value={f.admission_date} onChange={set("admission_date")} /></Field>
          <Field label="Class"><Select value={f.class_id} onChange={set("class_id")}><option value="">Select…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Arm / section"><Select value={f.arm_id} onChange={set("arm_id")} disabled={!arms.length}><option value="">{arms.length ? "Select…" : "No arms"}</option>{arms.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <Field label="Admission number" hint={student ? undefined : "Leave blank to generate automatically"}><Input value={f.admission_no} onChange={set("admission_no")} /></Field>
          {student && <Field label="Status"><Select value={f.status} onChange={set("status")}>{["ACTIVE", "INACTIVE", "GRADUATED", "WITHDRAWN"].map((s) => <option key={s}>{s}</option>)}</Select></Field>}
          <Field label="State of origin"><Input value={f.state_of_origin} onChange={set("state_of_origin")} /></Field>
          <Field label="Religion"><Input value={f.religion} onChange={set("religion")} /></Field>
          <Field label="Blood group"><Input value={f.blood_group} onChange={set("blood_group")} maxLength={5} /></Field>
          <Field label="Previous school" className="sm:col-span-3"><Input value={f.previous_school} onChange={set("previous_school")} /></Field>
          <Field label="Home address" className="sm:col-span-3"><Textarea rows={2} value={f.address} onChange={set("address")} /></Field>
          <Field label="Medical notes" className="sm:col-span-3"><Textarea rows={2} value={f.medical_notes} onChange={set("medical_notes")} /></Field>
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-3 font-display text-lg font-semibold">Parent / guardian</legend>
          <Field label="Full name"><Input value={f.parent_name} onChange={set("parent_name")} /></Field>
          <Field label="Relationship"><Input value={f.parent_relationship} onChange={set("parent_relationship")} /></Field>
          <Field label="Occupation"><Input value={f.parent_occupation} onChange={set("parent_occupation")} /></Field>
          <Field label="Phone" hint="e.g. 08031234567"><Input type="tel" value={f.parent_phone} onChange={set("parent_phone")} /></Field>
          <Field label="Email"><Input type="email" value={f.parent_email} onChange={set("parent_email")} /></Field>
          <Field label="Address"><Input value={f.parent_address} onChange={set("parent_address")} /></Field>
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-3 font-display text-lg font-semibold">Emergency contact</legend>
          <Field label="Name"><Input value={f.emergency_name} onChange={set("emergency_name")} /></Field>
          <Field label="Phone"><Input type="tel" value={f.emergency_phone} onChange={set("emergency_phone")} /></Field>
          <Field label="Relationship"><Input value={f.emergency_relationship} onChange={set("emergency_relationship")} /></Field>
        </fieldset>
      </form>
    </Modal>
  );
}

function PromoteModal({ open, onClose, ids, onDone }: { open: boolean; onClose: () => void; ids: number[]; onDone: () => void }) {
  const { sessions, classes } = useLookups();
  const toast = useToast();
  const [sessionId, setSessionId] = useState("");
  const [classId, setClassId] = useState("");
  const [armId, setArmId] = useState("");
  const [graduate, setGraduate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const arms: Rec[] = classes.find((c) => String(c.id) === classId)?.arms ?? [];
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await post<Rec>("/api/students/promote", { student_ids: ids, to_session_id: Number(sessionId), to_class_id: classId ? Number(classId) : null, to_arm_id: armId ? Number(armId) : null, graduate });
      toast.success(`${r.promoted} student(s) ${graduate ? "graduated" : "promoted"}${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}`);
      onDone();
      onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Promote ${ids.length} student(s)`} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={run} loading={busy} disabled={!sessionId || (!graduate && !classId)}>Confirm</Button></>}>
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Target session" required><Select value={sessionId} onChange={(e) => setSessionId(e.target.value)}><option value="">Select…</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={graduate} onChange={(e) => setGraduate(e.target.checked)} /> Mark as graduated (no new class)</label>
        {!graduate && <>
          <Field label="Target class" required><Select value={classId} onChange={(e) => { setClassId(e.target.value); setArmId(""); }}><option value="">Select…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Arm"><Select value={armId} onChange={(e) => setArmId(e.target.value)} disabled={!arms.length}><option value="">Any</option>{arms.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        </>}
      </div>
    </Modal>
  );
}

export default function Students() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const { classes, current } = useLookups();
  const [q, setQ] = useState("");
  const [classId, setClassId] = useState("");
  const [armId, setArmId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(params.get("new") === "1");
  const [promote, setPromote] = useState(false);
  const [sel, setSel] = useState<number[]>([]);
  const dq = useDebounced(q);
  const toast = useToast();
  const canWrite = can("students.write");
  const arms: Rec[] = classes.find((c) => String(c.id) === classId)?.arms ?? [];

  const { data, loading, error, reload } = useFetch(
    () => get<Paged>("/api/students", { q: dq, class_id: classId, arm_id: armId, status, page, page_size: 20 }),
    [dq, classId, armId, status, page],
  );
  useEffect(() => setPage(1), [dq, classId, armId, status]);
  useEffect(() => { if (params.get("new")) setParams({}, { replace: true }); }, []); // eslint-disable-line

  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allOnPage = !!data?.items.length && data.items.every((s) => sel.includes(s.id));

  return (
    <>
      <PageHeader title="Students" description={current ? `Enrolment for the ${current.name} session` : undefined}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
          <Button variant="outline" size="sm" onClick={() => saveFile("/api/students/export.csv", "students.csv", { q: dq, class_id: classId, arm_id: armId, status }).catch((e) => toast.error(e.message))}><Download className="size-4" /> Export CSV</Button>
          {canWrite && <Button variant="outline" size="sm" disabled={!sel.length} onClick={() => setPromote(true)}><TrendingUp className="size-4" /> Promote ({sel.length})</Button>}
          {canWrite && <Button size="sm" onClick={() => setForm(true)}><Plus className="size-4" /> Register student</Button>}
        </>} />
      <Card>
        <div className="no-print flex flex-wrap gap-3 border-b border-line p-4">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, student ID or admission no." className="max-w-sm flex-1" aria-label="Search students" />
          <Select value={classId} onChange={(e) => { setClassId(e.target.value); setArmId(""); }} className="w-40" aria-label="Class"><option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select value={armId} onChange={(e) => setArmId(e.target.value)} className="w-32" aria-label="Arm" disabled={!arms.length}><option value="">All arms</option>{arms.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Status"><option value="">Any status</option>{["ACTIVE", "INACTIVE", "GRADUATED", "WITHDRAWN"].map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</Select>
        </div>
        <Async loading={loading} error={error} onRetry={reload} empty={!data?.items.length}
          emptyNode={<EmptyState icon={<GraduationCap className="size-7" />} title="No students found" description={dq || classId || status ? "Try changing the search or filters." : "Register your first student to get started."} action={canWrite && !dq ? <Button onClick={() => setForm(true)}><Plus className="size-4" /> Register student</Button> : undefined} />}>
          {data && <>
          <TableWrap>
            <thead className="bg-stone-50"><tr>{canWrite && <th className="th no-print w-10"><input type="checkbox" aria-label="Select all" checked={allOnPage} onChange={() => setSel(allOnPage ? sel.filter((i) => !data!.items.some((s) => s.id === i)) : [...new Set([...sel, ...data!.items.map((s) => s.id)])])} /></th>}<th className="th">Student</th><th className="th">Student ID</th><th className="th">Admission no.</th><th className="th">Class</th><th className="th">Gender</th><th className="th">Status</th></tr></thead>
            <tbody>
              {data!.items.map((s) => (
                <tr key={s.id} className="border-t border-line hover:bg-brand-50/40">
                  {canWrite && <td className="td no-print"><input type="checkbox" aria-label={`Select ${s.full_name}`} checked={sel.includes(s.id)} onChange={() => toggle(s.id)} /></td>}
                  <td className="td font-semibold"><Link to={`/portal/students/${s.id}`} className="text-brand-800 hover:underline">{s.full_name}</Link></td>
                  <td className="td font-mono text-xs">{s.student_no}</td><td className="td font-mono text-xs">{s.admission_no}</td>
                  <td className="td">{s.class_name ?? <span className="text-muted">—</span>}</td><td className="td capitalize">{s.gender?.toLowerCase() ?? "—"}</td><td className="td"><StatusBadge status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <Pagination page={page} pageSize={20} total={data?.total ?? 0} onChange={setPage} />
          </>}
        </Async>
      </Card>
      <StudentFormModal open={form} onClose={() => setForm(false)} onSaved={() => reload()} />
      <PromoteModal open={promote} onClose={() => setPromote(false)} ids={sel} onDone={() => { setSel([]); reload(); }} />
      {loading && data && <Spinner className="fixed bottom-4 right-4" />}
    </>
  );
}
