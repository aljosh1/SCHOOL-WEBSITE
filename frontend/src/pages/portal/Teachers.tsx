import { useEffect, useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { get, post, put, type Paged, type Rec } from "@/lib/api";
import { useDebounced, useFetch, useToast } from "@/lib/hooks";
import { useLookups } from "@/lib/lookups";
import { nullify } from "@/lib/utils";
import { Alert, Async, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Switch, TableWrap, Textarea } from "@/components/ui";

const EMPTY = { full_name: "", username: "", email: "", phone: "", staff_no: "", qualification: "", bio: "", public_title: "", show_on_website: true, is_active: true };

function TeacherForm({ open, onClose, teacher, onSaved }: { open: boolean; onClose: () => void; teacher: Rec | null; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Rec>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<Rec | null>(null);
  useEffect(() => { if (open) { setError(null); setF(teacher ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, teacher[k] ?? (typeof (EMPTY as Rec)[k] === "boolean" ? true : "")])) : EMPTY); } }, [open, teacher]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = nullify({ ...f, username: teacher ? undefined : f.username });
      const res = teacher ? await put<Rec>(`/api/teachers/${teacher.id}`, body) : await post<Rec>("/api/teachers", body);
      toast.success(teacher ? "Teacher updated" : "Teacher created");
      onSaved();
      if (res.credentials) setCreds(res.credentials); else onClose();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  if (creds) return (
    <Modal open onClose={() => { setCreds(null); onClose(); }} title="Teacher account created" size="sm" footer={<Button onClick={() => { setCreds(null); onClose(); }}>Done</Button>}>
      <Alert tone="warn">Share these details securely. The temporary password is shown only once and must be changed at first sign-in.</Alert>
      <dl className="mt-4 space-y-3 rounded-xl bg-stone-50 p-4 text-sm"><div><dt className="text-muted">Username</dt><dd className="font-mono text-lg font-bold">{creds.username}</dd></div><div><dt className="text-muted">Temporary password</dt><dd className="font-mono text-lg font-bold">{creds.temporary_password}</dd></div></dl>
    </Modal>
  );

  return (
    <Modal open={open} onClose={onClose} title={teacher ? "Edit teacher" : "Add teacher"} size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="teacher-form" loading={busy}>Save</Button></>}>
      <form id="teacher-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><Alert tone="error">{error}</Alert></div>}
        <Field label="Full name" required><Input required value={f.full_name} onChange={set("full_name")} /></Field>
        {!teacher && <Field label="Username" hint="Leave blank to generate from the name"><Input value={f.username} onChange={set("username")} /></Field>}
        <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Phone" hint="e.g. 08031234567"><Input type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Staff number" hint={teacher ? undefined : "Generated if blank"}><Input value={f.staff_no} onChange={set("staff_no")} /></Field>
        <Field label="Qualification"><Input value={f.qualification} onChange={set("qualification")} /></Field>
        <Field label="Public title (website)"><Input value={f.public_title} onChange={set("public_title")} placeholder="Teacher of Mathematics" /></Field>
        <Field label="Short bio" className="sm:col-span-2"><Textarea rows={2} value={f.bio} onChange={set("bio")} /></Field>
        <Switch checked={f.show_on_website} onChange={(v) => setF({ ...f, show_on_website: v })} label="Show on the public website" />
        {teacher && <Switch checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Account active" />}
      </form>
    </Modal>
  );
}

function AssignmentsModal({ teacher, onClose }: { teacher: Rec | null; onClose: () => void }) {
  const { sessions, classes, subjects, current } = useLookups();
  const toast = useToast();
  const [sessionId, setSessionId] = useState("");
  const [items, setItems] = useState<Rec[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (current && !sessionId) setSessionId(String(current.id)); }, [current, sessionId]);
  useEffect(() => {
    if (!teacher || !sessionId) return;
    setLoading(true);
    get<Rec[]>(`/api/teachers/${teacher.id}/assignments`, { session_id: sessionId })
      .then((r) => setItems(r.map((a) => ({ class_id: String(a.class_id), arm_id: a.arm_id ? String(a.arm_id) : "", subject_id: String(a.subject_id) }))))
      .catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [teacher, sessionId]);

  const upd = (i: number, patch: Rec) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { session_id: Number(sessionId), items: items.filter((x) => x.class_id && x.subject_id).map((x) => ({ class_id: Number(x.class_id), arm_id: x.arm_id ? Number(x.arm_id) : null, subject_id: Number(x.subject_id) })) };
      await put(`/api/teachers/${teacher!.id}/assignments`, body);
      toast.success("Assignments saved");
      onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal open={!!teacher} onClose={onClose} title={`Class & subject assignments — ${teacher?.full_name ?? ""}`} size="xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save assignments</Button></>}>
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Session" className="max-w-xs"><Select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <p className="text-sm text-muted">A teacher can enter results and upload materials only for the class and subject combinations listed here.</p>
        {loading ? <p className="text-sm text-muted">Loading…</p> : (
          <div className="space-y-2">
            {items.map((it, i) => {
              const arms: Rec[] = classes.find((c) => String(c.id) === it.class_id)?.arms ?? [];
              return (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2 max-sm:grid-cols-1">
                  <Select aria-label="Class" value={it.class_id} onChange={(e) => upd(i, { class_id: e.target.value, arm_id: "" })}><option value="">Class…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                  <Select aria-label="Arm" value={it.arm_id} onChange={(e) => upd(i, { arm_id: e.target.value })}><option value="">All arms</option>{arms.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
                  <Select aria-label="Subject" value={it.subject_id} onChange={(e) => upd(i, { subject_id: e.target.value })}><option value="">Subject…</option>{subjects.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
                  <Button variant="ghost" size="sm" aria-label="Remove assignment" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="size-4 text-red-600" /></Button>
                </div>
              );
            })}
            <Button variant="outline" size="sm" onClick={() => setItems([...items, { class_id: "", arm_id: "", subject_id: "" }])}><Plus className="size-4" /> Add assignment</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function Teachers() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch(() => get<Paged>("/api/teachers", { q: dq, page, page_size: 20 }), [dq, page]);
  const [form, setForm] = useState<{ open: boolean; teacher: Rec | null }>({ open: false, teacher: null });
  const [assign, setAssign] = useState<Rec | null>(null);
  useEffect(() => setPage(1), [dq]);

  return (
    <>
      <PageHeader title="Teachers" description="Create teacher accounts and assign the classes and subjects they teach."
        actions={<Button size="sm" onClick={() => setForm({ open: true, teacher: null })}><Plus className="size-4" /> Add teacher</Button>} />
      <Card>
        <div className="border-b border-line p-4"><Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or staff number" className="max-w-sm" aria-label="Search teachers" /></div>
        <Async loading={loading} error={error} onRetry={reload} empty={!data?.items.length} emptyNode={<EmptyState icon={<Users className="size-7" />} title="No teachers found" description="Add a teacher to give them access to the teacher dashboard." />}>
          {data && <>
          <TableWrap>
            <thead className="bg-stone-50"><tr><th className="th">Name</th><th className="th">Staff no.</th><th className="th">Username</th><th className="th">Contact</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>
              {data!.items.map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="td font-semibold">{t.full_name}<div className="text-xs font-normal text-muted">{t.qualification}</div></td><td className="td font-mono text-xs">{t.staff_no}</td><td className="td font-mono text-xs">{t.username}</td>
                  <td className="td text-xs">{t.email}<br />{t.phone}</td><td className="td">{t.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>}</td>
                  <td className="td text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="soft" onClick={() => setAssign(t)}>Assignments</Button><Button size="sm" variant="outline" onClick={() => setForm({ open: true, teacher: t })}>Edit</Button></div></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <Pagination page={page} pageSize={20} total={data?.total ?? 0} onChange={setPage} />
          </>}
        </Async>
      </Card>
      <TeacherForm open={form.open} teacher={form.teacher} onClose={() => setForm({ open: false, teacher: null })} onSaved={reload} />
      <AssignmentsModal teacher={assign} onClose={() => setAssign(null)} />
    </>
  );
}
