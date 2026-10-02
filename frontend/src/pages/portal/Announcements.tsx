import { useEffect, useState } from "react";
import { Megaphone, Pencil, Plus, Trash2, UserCheck } from "lucide-react";
import { apiUrl, del, get, post, put, upload, type Paged, type Rec } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFetch, useToast } from "@/lib/hooks";
import { fmtDate, fmtDateTime, nullify, toIso } from "@/lib/utils";
import { Alert, Async, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, StatusBadge, TableWrap, Tabs, Textarea, useConfirm } from "@/components/ui";

const CATS = ["NEWS", "EXAM", "HOLIDAY", "EVENT", "ADMISSION", "PARENT_NOTICE", "ACADEMIC"];
const catLabel = (c: string) => c.replace("_", " ").toLowerCase().replace(/^\w/, (x) => x.toUpperCase());

export default function Announcements() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const manage = can("announcements.write");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch(() => get<Paged>("/api/announcements", { status, page, page_size: 10 }), [status, page]);
  const [form, setForm] = useState<{ open: boolean; item: Rec | null }>({ open: false, item: null });

  async function remove(a: Rec) {
    if (!(await confirm({ title: `Delete “${a.title}”?`, message: "This cannot be undone.", confirmLabel: "Delete", danger: true }))) return;
    try { await del(`/api/announcements/${a.id}`); toast.success("Announcement deleted"); reload(); } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <>
      <PageHeader title="Announcements" description={manage ? "Publish news, exam dates, holidays, events and notices." : "News and notices from the school."}
        actions={manage && <Button size="sm" onClick={() => setForm({ open: true, item: null })}><Plus className="size-4" /> New announcement</Button>} />
      {manage && <Tabs value={status} onChange={(s) => { setStatus(s); setPage(1); }} tabs={[{ id: "", label: "All" }, { id: "PUBLISHED", label: "Published" }, { id: "DRAFT", label: "Drafts" }]} />}
      <Card>
        <Async loading={loading} error={error} onRetry={reload} empty={!data?.items.length} emptyNode={<EmptyState icon={<Megaphone className="size-7" />} title="No announcements" description={manage ? "Publish your first announcement to inform students and parents." : "Nothing has been announced yet."} action={manage ? <Button onClick={() => setForm({ open: true, item: null })}>New announcement</Button> : undefined} />}>
          {data && <>
          <div className="divide-y divide-line">
            {data!.items.map((a) => (
              <article key={a.id} className="flex flex-col gap-4 p-5 sm:flex-row">
                {a.image_url && <img src={apiUrl(a.image_url)} alt="" loading="lazy" className="h-32 w-full rounded-xl object-cover sm:w-44" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone="amber">{catLabel(a.category)}</Badge>{manage && <StatusBadge status={a.status} />}{manage && !a.is_public && <Badge>Portal only</Badge>}<span className="text-xs text-muted">{fmtDate(a.published_at ?? a.created_at)} · {a.author ?? "School"}</span></div>
                  <h2 className="mt-1.5 text-xl font-semibold">{a.title}</h2>
                  {a.event_date && <div className="text-sm font-medium text-brand-700">Event date: {fmtDate(a.event_date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>}
                  <p className="mt-1.5 whitespace-pre-line text-[15px] text-muted">{a.body}</p>
                  {manage && a.expires_at && <div className="mt-1 text-xs text-muted">Expires {fmtDateTime(a.expires_at)}</div>}
                </div>
                {manage && <div className="flex gap-1 self-start"><Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setForm({ open: true, item: a })}><Pencil className="size-4" /></Button><Button size="sm" variant="ghost" aria-label="Delete" onClick={() => remove(a)}><Trash2 className="size-4 text-red-600" /></Button></div>}
              </article>
            ))}
          </div>
          <Pagination page={page} pageSize={10} total={data?.total ?? 0} onChange={setPage} />
          </>}
        </Async>
      </Card>
      <AnnouncementForm open={form.open} item={form.item} onClose={() => setForm({ open: false, item: null })} onSaved={reload} />
    </>
  );
}

function AnnouncementForm({ open, item, onClose, onSaved }: { open: boolean; item: Rec | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Rec>({});
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null); setImage(null);
    setF(item ? { title: item.title, body: item.body, category: item.category, event_date: item.event_date ?? "", status: item.status, expires_at: item.expires_at ? item.expires_at.slice(0, 10) : "", is_public: item.is_public }
      : { title: "", body: "", category: "NEWS", event_date: "", status: "PUBLISHED", expires_at: "", is_public: true });
  }, [open, item]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = nullify({ ...f, expires_at: f.expires_at ? toIso(f.expires_at + "T23:59:59") : null });
      const saved = item ? await put<Rec>(`/api/announcements/${item.id}`, body) : await post<Rec>("/api/announcements", body);
      if (image) { const fd = new FormData(); fd.append("file", image); await upload(`/api/announcements/${saved.id}/image`, fd); }
      toast.success("Announcement saved"); onSaved(); onClose();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={item ? "Edit announcement" : "New announcement"} size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="ann-form" loading={busy}>Save</Button></>}>
      <form id="ann-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><Alert tone="error">{error}</Alert></div>}
        <Field label="Title" required className="sm:col-span-2"><Input required minLength={3} maxLength={200} value={f.title ?? ""} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Content" required className="sm:col-span-2"><Textarea required rows={6} value={f.body ?? ""} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <Field label="Category"><Select value={f.category ?? "NEWS"} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}</Select></Field>
        <Field label="Event / exam date" hint="Shown under Upcoming events"><Input type="date" value={f.event_date ?? ""} onChange={(e) => setF({ ...f, event_date: e.target.value })} /></Field>
        <Field label="Status"><Select value={f.status ?? "DRAFT"} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="PUBLISHED">Published</option><option value="DRAFT">Draft</option></Select></Field>
        <Field label="Expires on" hint="Hidden after this date"><Input type="date" value={f.expires_at ?? ""} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></Field>
        <Field label="Audience"><Select value={f.is_public ? "public" : "portal"} onChange={(e) => setF({ ...f, is_public: e.target.value === "public" })}><option value="public">Public website and portal</option><option value="portal">Portal users only</option></Select></Field>
        <Field label="Image" hint="Optional (JPG, PNG or WebP)"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setImage(e.target.files?.[0] ?? null)} className="input file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:font-semibold file:text-brand-800" /></Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- admissions review

export function AdmissionsReview() {
  const toast = useToast();
  const [status, setStatus] = useState("PENDING");
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch(() => get<Paged>("/api/applications", { status, page, page_size: 15 }), [status, page]);
  const [open, setOpen] = useState<Rec | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<Rec | null>(null);
  const confirm = useConfirm();

  async function review(s: string) {
    setBusy(true);
    try { await put(`/api/applications/${open!.id}`, { status: s, review_note: note || null }); toast.success("Application updated"); setOpen(null); reload(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function admit() {
    if (!(await confirm({ title: "Admit this applicant?", message: "A student record and login will be created in the applied class (current session).", confirmLabel: "Admit" }))) return;
    setBusy(true);
    try { const r = await post<Rec>(`/api/applications/${open!.id}/admit`); setCreds(r.credentials ? { ...r.credentials, name: r.full_name, id: r.student_no } : null); setOpen(null); reload(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Admission applications" description="Review online applications and admit successful applicants." />
      <Tabs value={status} onChange={(s) => { setStatus(s); setPage(1); }} tabs={[{ id: "PENDING", label: "New" }, { id: "UNDER_REVIEW", label: "Under review" }, { id: "ACCEPTED", label: "Accepted" }, { id: "ADMITTED", label: "Admitted" }, { id: "REJECTED", label: "Rejected" }]} />
      <Card>
        <Async loading={loading} error={error} onRetry={reload} empty={!data?.items.length} emptyNode={<EmptyState icon={<UserCheck className="size-7" />} title="No applications here" description="Online applications will appear in this list." />}>
          {data && <>
          <TableWrap>
            <thead className="bg-stone-50"><tr><th className="th">Reference</th><th className="th">Applicant</th><th className="th">Class</th><th className="th">Guardian</th><th className="th">Received</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>{data!.items.map((a) => (
              <tr key={a.id} className="border-t border-line"><td className="td font-mono text-xs">{a.reference}</td><td className="td font-semibold">{a.full_name}<div className="text-xs font-normal capitalize text-muted">{a.gender?.toLowerCase()} · born {fmtDate(a.date_of_birth)}</div></td><td className="td">{a.class_applied}</td>
                <td className="td text-sm">{a.guardian_name}<div className="text-xs text-muted">{a.guardian_phone}</div></td><td className="td text-xs">{fmtDate(a.created_at)}</td><td className="td"><StatusBadge status={a.status} /></td>
                <td className="td text-right"><Button size="sm" variant="outline" onClick={() => { setOpen(a); setNote(a.review_note ?? ""); }}>Review</Button></td></tr>
            ))}</tbody>
          </TableWrap>
          <Pagination page={page} pageSize={15} total={data?.total ?? 0} onChange={setPage} />
          </>}
        </Async>
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={`Application ${open?.reference ?? ""}`} size="lg"
        footer={open && !open.student_id ? <><Button variant="outline" onClick={() => review("UNDER_REVIEW")} disabled={busy}>Mark under review</Button><Button variant="danger" onClick={() => review("REJECTED")} disabled={busy}>Reject</Button><Button variant="outline" onClick={() => review("ACCEPTED")} disabled={busy}>Accept</Button><Button onClick={admit} loading={busy}>Admit & create student</Button></> : undefined}>
        {open && <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">{[["Applicant", open.full_name], ["Date of birth", fmtDate(open.date_of_birth)], ["Gender", open.gender], ["Class applied for", open.class_applied], ["Previous school", open.previous_school], ["State of origin", open.state_of_origin], ["Address", open.address], ["Medical notes", open.medical_notes], ["Guardian", `${open.guardian_name}${open.guardian_relationship ? ` (${open.guardian_relationship})` : ""}`], ["Guardian phone", open.guardian_phone], ["Guardian email", open.guardian_email]].map(([k, v]) => <div key={k}><dt className="text-xs font-semibold uppercase tracking-wide text-muted">{k}</dt><dd className="font-medium">{v || "—"}</dd></div>)}</dl>
          <Field label="Review note"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
        </div>}
      </Modal>
      <Modal open={!!creds} onClose={() => setCreds(null)} title="Student admitted" size="sm" footer={<Button onClick={() => setCreds(null)}>Done</Button>}>
        {creds && <><Alert tone="warn">Copy these login details now; the temporary password is shown only once.</Alert><dl className="mt-4 space-y-3 rounded-xl bg-stone-50 p-4 text-sm"><div><dt className="text-muted">Student</dt><dd className="font-semibold">{creds.name}</dd></div><div><dt className="text-muted">Username</dt><dd className="font-mono text-lg font-bold">{creds.username}</dd></div><div><dt className="text-muted">Temporary password</dt><dd className="font-mono text-lg font-bold">{creds.temporary_password}</dd></div></dl></>}
      </Modal>
    </>
  );
}
