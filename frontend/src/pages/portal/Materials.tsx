import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, Eye, File as FileIcon, FileText, Film, Image as ImageIcon, Music, Pencil, Plus, Presentation, Trash2, Upload } from "lucide-react";
import { del, get, openFile, put, saveFile, upload, type Paged, type Rec } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced, useFetch, useToast } from "@/lib/hooks";
import { useLookups } from "@/lib/lookups";
import { cn, fmtBytes, fmtDate } from "@/lib/utils";
import { Alert, Async, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, StatusBadge, Switch, Textarea, useConfirm } from "@/components/ui";

const KINDS = ["PDF", "DOCUMENT", "PRESENTATION", "IMAGE", "VIDEO", "AUDIO", "TEXT", "PAST_QUESTION", "ASSIGNMENT", "NOTE"];
const kindIcon = (k: string) => ({ PDF: FileText, DOCUMENT: FileText, PRESENTATION: Presentation, IMAGE: ImageIcon, VIDEO: Film, AUDIO: Music, TEXT: FileText, NOTE: FileText, PAST_QUESTION: FileText, ASSIGNMENT: FileText } as Record<string, typeof FileIcon>)[k] ?? FileIcon;
const label = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export default function Materials() {
  const { user, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const { classes, subjects, sessions, current } = useLookups();
  const isStudent = user?.role === "STUDENT";
  const canWrite = can("materials.write");
  const [f, setF] = useState({ q: "", class_id: "", subject_id: params.get("subject_id") ?? "", term_id: "", kind: "", visibility: "" });
  const dq = useDebounced(f.q);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ open: boolean; item: Rec | null }>({ open: params.get("new") === "1" && canWrite, item: null });
  const [view, setView] = useState<Rec | null>(null);
  const tiles = useFetch(() => get<Rec[]>("/api/materials/subjects", { class_id: f.class_id }), [f.class_id], isStudent || !!f.class_id);
  const { data, loading, error, reload } = useFetch(() => get<Paged>("/api/materials", { ...f, q: dq, page, page_size: 12 }), [dq, f.class_id, f.subject_id, f.term_id, f.kind, f.visibility, page]);
  const terms: Rec[] = sessions.find((s) => s.id === current?.id)?.terms ?? [];
  useEffect(() => setPage(1), [dq]);
  useEffect(() => { if (params.get("new") || params.get("subject_id")) setParams({}, { replace: true }); }, []); // eslint-disable-line
  const set = (k: string, v: string) => { setF({ ...f, [k]: v }); setPage(1); };

  async function remove(m: Rec) {
    if (!(await confirm({ title: `Delete “${m.title}”?`, message: "The file will be permanently removed.", confirmLabel: "Delete", danger: true }))) return;
    try { await del(`/api/materials/${m.id}`); toast.success("Material deleted"); reload(); } catch (e) { toast.error((e as Error).message); }
  }
  const download = (m: Rec) => saveFile(`/api/materials/${m.id}/download`, m.file_name ?? "material").catch((e) => toast.error(e.message));
  const open = (m: Rec) => (m.has_file ? openFile(`/api/materials/${m.id}/download`, { inline: true }).catch((e) => toast.error(e.message)) : setView(m));

  const activeSubject = useMemo(() => tiles.data?.find((t) => String(t.subject_id) === f.subject_id), [tiles.data, f.subject_id]);

  return (
    <>
      <PageHeader title={isStudent ? "My learning materials" : "Learning materials"} description={isStudent ? "Notes, assignments and past questions shared by your teachers." : "Upload and publish notes, assignments, past questions and media for your classes."}
        actions={canWrite && <Button size="sm" onClick={() => setForm({ open: true, item: null })}><Upload className="size-4" /> Upload material</Button>} />

      {(isStudent || f.class_id) && (
        <div className="mb-6">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Subjects</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            <button onClick={() => set("subject_id", "")} className={cn("rounded-xl border p-3 text-left transition", !f.subject_id ? "border-brand-600 bg-brand-50" : "border-line bg-white hover:border-brand-400")}><div className="font-semibold">All subjects</div></button>
            {tiles.data?.map((t) => (
              <button key={t.subject_id} onClick={() => set("subject_id", String(t.subject_id))} className={cn("rounded-xl border p-3 text-left transition", String(t.subject_id) === f.subject_id ? "border-brand-600 bg-brand-50" : "border-line bg-white hover:border-brand-400")}>
                <div className="font-semibold leading-tight">{t.subject}</div><div className="mt-0.5 text-xs text-muted">{t.count} resource{t.count === 1 ? "" : "s"}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <Input type="search" placeholder="Search materials…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="min-w-52 max-w-xs flex-1" aria-label="Search materials" />
          {!isStudent && <Select className="w-36" value={f.class_id} onChange={(e) => set("class_id", e.target.value)} aria-label="Class"><option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
          {!isStudent && <Select className="w-44" value={f.subject_id} onChange={(e) => set("subject_id", e.target.value)} aria-label="Subject"><option value="">All subjects</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
          <Select className="w-36" value={f.term_id} onChange={(e) => set("term_id", e.target.value)} aria-label="Term"><option value="">All terms</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          <Select className="w-40" value={f.kind} onChange={(e) => set("kind", e.target.value)} aria-label="Type"><option value="">All types</option>{KINDS.map((k) => <option key={k} value={k}>{label(k)}</option>)}</Select>
          {!isStudent && <Select className="w-36" value={f.visibility} onChange={(e) => set("visibility", e.target.value)} aria-label="Visibility"><option value="">Any visibility</option>{["DRAFT", "PUBLISHED", "ARCHIVED"].map((v) => <option key={v} value={v}>{label(v)}</option>)}</Select>}
        </div>
        <Async loading={loading} error={error} onRetry={reload} empty={!data?.items.length} emptyNode={<EmptyState title={activeSubject ? `No ${activeSubject.subject} materials yet` : "No materials found"} description={isStudent ? "Your teachers have not shared anything here yet." : "Upload a material to share it with a class."} action={canWrite ? <Button onClick={() => setForm({ open: true, item: null })}><Plus className="size-4" /> Upload material</Button> : undefined} />}>
          {data && <>
          <ul className="divide-y divide-line">
            {data!.items.map((m) => {
              const Icon = kindIcon(m.kind);
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon className="size-6" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-base font-semibold">{m.title}</h3>{!isStudent && <StatusBadge status={m.visibility} />}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted"><span>{m.class_name} · {m.subject}</span><span>{m.session} · {m.term}</span><span>{label(m.kind)}{m.file_name ? ` · ${fmtBytes(m.size_bytes)}` : ""}</span><span>{m.teacher ?? "—"} · {fmtDate(m.created_at)}</span></div>
                    {m.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{m.description}</p>}
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => open(m)}><Eye className="size-4" /> View</Button>
                    {m.has_file && <Button size="sm" variant="outline" aria-label="Download" onClick={() => download(m)}><Download className="size-4" /></Button>}
                    {m.can_manage && <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setForm({ open: true, item: m })}><Pencil className="size-4" /></Button>}
                    {m.can_manage && <Button size="sm" variant="ghost" aria-label="Delete" onClick={() => remove(m)}><Trash2 className="size-4 text-red-600" /></Button>}
                  </div>
                </li>
              );
            })}
          </ul>
          <Pagination page={page} pageSize={12} total={data?.total ?? 0} onChange={setPage} />
          </>}
        </Async>
      </Card>

      <Modal open={!!view} onClose={() => setView(null)} title={view?.title ?? ""} size="lg">
        {view && <><div className="mb-3 flex gap-2"><Badge tone="blue">{view.subject}</Badge><Badge>{view.class_name}</Badge></div><p className="whitespace-pre-wrap text-[15px] leading-relaxed">{view.text_content}</p></>}
      </Modal>
      <MaterialForm open={form.open} item={form.item} onClose={() => setForm({ open: false, item: null })} onSaved={reload} />
    </>
  );
}

function MaterialForm({ open, item, onClose, onSaved }: { open: boolean; item: Rec | null; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const { classes, subjects, sessions, current, currentTerm } = useLookups();
  const overview = useFetch(() => get<Rec>("/api/teachers/me/overview"), [], open && user?.role === "TEACHER");
  const [f, setF] = useState<Rec>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null); setFile(null);
    setF(item ? { title: item.title, description: item.description ?? "", visibility: item.visibility, text_content: item.text_content ?? "" }
      : { title: "", description: "", subject_id: "", class_id: "", session_id: String(current?.id ?? ""), term_id: String(currentTerm?.id ?? ""), kind: "", visibility: "PUBLISHED", text_content: "" });
  }, [open, item, current, currentTerm]);

  const teacher = user?.role === "TEACHER";
  const assigned: Rec[] = overview.data?.assignments ?? [];
  const classOptions = teacher ? classes.filter((c) => assigned.some((a) => a.class_id === c.id)) : classes;
  const subjectOptions = teacher ? subjects.filter((s) => assigned.some((a) => a.subject_id === s.id && String(a.class_id) === f.class_id)) : subjects.filter((s) => s.is_active);
  const terms: Rec[] = sessions.find((s) => String(s.id) === String(f.session_id))?.terms ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (item) {
        await put(`/api/materials/${item.id}`, { title: f.title, description: f.description || null, visibility: f.visibility, text_content: f.text_content || null });
      } else {
        const fd = new FormData();
        for (const k of ["title", "description", "subject_id", "class_id", "session_id", "term_id", "kind", "visibility", "text_content"]) if (f[k]) fd.append(k, f[k]);
        if (file) fd.append("file", file);
        await upload("/api/materials", fd);
      }
      toast.success(item ? "Material updated" : "Material uploaded");
      onSaved(); onClose();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={item ? "Edit material" : "Upload material"} size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="material-form" loading={busy}>{item ? "Save" : "Upload"}</Button></>}>
      <form id="material-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><Alert tone="error">{error}</Alert></div>}
        <Field label="Title" required className="sm:col-span-2"><Input required minLength={2} maxLength={200} value={f.title ?? ""} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea rows={2} value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        {!item && <>
          <Field label="Class" required><Select required value={f.class_id ?? ""} onChange={(e) => setF({ ...f, class_id: e.target.value, subject_id: "" })}><option value="">Select…</option>{classOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Subject" required><Select required value={f.subject_id ?? ""} onChange={(e) => setF({ ...f, subject_id: e.target.value })} disabled={!f.class_id}><option value="">Select…</option>{subjectOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Session"><Select value={f.session_id ?? ""} onChange={(e) => setF({ ...f, session_id: e.target.value, term_id: "" })}>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Term"><Select value={f.term_id ?? ""} onChange={(e) => setF({ ...f, term_id: e.target.value })}>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <Field label="Label" hint="Optional. The file type is detected automatically."><Select value={f.kind ?? ""} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">Auto</option><option value="NOTE">Note</option><option value="ASSIGNMENT">Assignment</option><option value="PAST_QUESTION">Past question</option></Select></Field>
        </>}
        <Field label="Visibility"><Select value={f.visibility ?? "DRAFT"} onChange={(e) => setF({ ...f, visibility: e.target.value })}><option value="DRAFT">Draft (hidden from students)</option><option value="PUBLISHED">Published</option>{item && <option value="ARCHIVED">Archived</option>}</Select></Field>
        {!item && <Field label="File" className="sm:col-span-2" hint="PDF, Word, PowerPoint, Excel, images, MP4/WebM video, MP3/WAV/M4A audio or text. Max 15 MB (documents) / 60 MB (audio & video).">
          <input type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.mp3,.wav,.m4a,.ogg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="input file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:font-semibold file:text-brand-800" />
        </Field>}
        <Field label="Text content" className="sm:col-span-2" hint={item ? undefined : "Write the material directly, or attach a file above."}><Textarea rows={5} value={f.text_content ?? ""} onChange={(e) => setF({ ...f, text_content: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Switch checked={f.visibility === "PUBLISHED"} onChange={(v) => setF({ ...f, visibility: v ? "PUBLISHED" : "DRAFT" })} label="Publish to students now" /></div>
      </form>
    </Modal>
  );
}
