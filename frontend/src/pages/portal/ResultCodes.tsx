import { useEffect, useState } from "react";
import { Download, Eye, FileText, Plus, Power, Printer, Search, Settings2, Ticket } from "lucide-react";
import { get, post, postForFile, put, saveFile, type Paged, type Rec } from "@/lib/api";
import { useDebounced, useFetch, useToast } from "@/lib/hooks";
import { useLookups } from "@/lib/lookups";
import { csvEscape, downloadText, fmtDateTime, toIso } from "@/lib/utils";
import { Alert, Async, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, StatCard, StatusBadge, TableWrap, useConfirm } from "@/components/ui";
import { PrintableCards, printCards } from "@/components/ScratchCards";

export default function ResultCodes() {
  const toast = useToast();
  const { sessions, current } = useLookups();
  const [f, setF] = useState({ q: "", status: "", session_id: "", term_id: "", batch_ref: "" });
  const dq = useDebounced(f.q);
  const [page, setPage] = useState(1);
  const summary = useFetch(() => get<Rec>("/api/result-codes/summary"), []);
  const list = useFetch(() => get<Paged>("/api/result-codes", { ...f, q: dq, page, page_size: 25 }), [dq, f.status, f.session_id, f.term_id, f.batch_ref, page]);
  const [gen, setGen] = useState(false);
  const [generated, setGenerated] = useState<Rec | null>(null);
  const [edit, setEdit] = useState<Rec | null>(null);
  const [logs, setLogs] = useState<Rec | null>(null);
  const confirm = useConfirm();
  const filterTerms: Rec[] = sessions.find((s) => String(s.id) === f.session_id)?.terms ?? [];
  useEffect(() => setPage(1), [dq]);
  const refresh = () => { list.reload(); summary.reload(); };

  async function toggle(c: Rec) {
    if (c.is_active && !(await confirm({ title: `Deactivate ${c.serial}?`, message: "The card can no longer be used to check results until it is re-activated.", confirmLabel: "Deactivate", danger: true }))) return;
    try { await put(`/api/result-codes/${c.id}`, { is_active: !c.is_active }); toast.success(c.is_active ? "Code deactivated" : "Code activated"); refresh(); } catch (e) { toast.error((e as Error).message); }
  }

  const S = summary.data;
  return (
    <>
      <PageHeader title="Result access codes" description="Generate secure scratch-card PINs for result checking. PINs are shown only once, at generation."
        actions={<><Button variant="outline" size="sm" onClick={() => saveFile("/api/result-codes/export.csv", "result-codes.csv", { ...f, q: dq }).catch((e) => toast.error(e.message))}><Download className="size-4" /> Export list (CSV)</Button><Button size="sm" onClick={() => setGen(true)}><Plus className="size-4" /> Generate codes</Button></>} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[["Total", S?.TOTAL, "brand"], ["Unused", S?.UNUSED, "brand"], ["In use", S?.USED, "blue"], ["Exhausted", S?.EXHAUSTED, "accent"], ["Expired / disabled", S ? S.EXPIRED + S.DISABLED : undefined, "violet"]].map(([l, v, t]: any) => <StatCard key={l} label={l} value={v ?? "—"} tone={t} icon={<Ticket className="size-5" />} />)}
      </div>
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-56 flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input type="search" placeholder="Serial, last 4 characters or student" className="pl-9" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Search codes" /></div>
          <Select className="w-40" value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }} aria-label="Status"><option value="">Any status</option>{["UNUSED", "USED", "EXHAUSTED", "EXPIRED", "DISABLED"].map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</Select>
          <Select className="w-40" value={f.session_id} onChange={(e) => { setF({ ...f, session_id: e.target.value, term_id: "" }); setPage(1); }} aria-label="Session"><option value="">All sessions</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Select className="w-40" value={f.term_id} onChange={(e) => { setF({ ...f, term_id: e.target.value }); setPage(1); }} aria-label="Term" disabled={!filterTerms.length}><option value="">All terms</option>{filterTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          {f.batch_ref && <Badge tone="blue" className="self-center">Batch {f.batch_ref} <button className="ml-1" aria-label="Clear batch filter" onClick={() => setF({ ...f, batch_ref: "" })}>×</button></Badge>}
        </div>
        <Async loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.data?.items.length} emptyNode={<EmptyState icon={<Ticket className="size-7" />} title="No codes found" description="Generate a batch of codes to start issuing result-checking cards." action={<Button onClick={() => setGen(true)}>Generate codes</Button>} />}>
          {list.data && <>
          <TableWrap>
            <thead className="bg-stone-50"><tr><th className="th">Serial</th><th className="th">PIN</th><th className="th">Session / term</th><th className="th">Uses</th><th className="th">Expires</th><th className="th">Student</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>{list.data!.items.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="td font-mono text-xs font-bold">{c.serial}<button className="block text-[10px] font-normal text-brand-700 hover:underline" onClick={() => setF({ ...f, batch_ref: c.batch_ref })}>{c.batch_ref}</button></td>
                <td className="td font-mono text-xs text-muted">{c.masked}</td><td className="td text-sm">{c.session}<div className="text-xs text-muted">{c.term ?? "Any term"}</div></td>
                <td className="td tabular-nums">{c.use_count}/{c.max_uses}</td><td className="td text-xs">{c.expires_at ? fmtDateTime(c.expires_at) : "Never"}</td>
                <td className="td text-xs">{c.student ?? <span className="text-muted">Unassigned</span>}{c.student_no && <div className="font-mono text-muted">{c.student_no}</div>}</td><td className="td"><StatusBadge status={c.status} /></td>
                <td className="td"><div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" title="Usage history" aria-label="Usage history" onClick={() => setLogs(c)}><Eye className="size-4" /></Button>
                  <Button size="sm" variant="ghost" title="Edit limits, expiry or assignment" aria-label="Edit code" onClick={() => setEdit(c)}><Settings2 className="size-4" /></Button>
                  <Button size="sm" variant="ghost" title={c.is_active ? "Deactivate" : "Activate"} aria-label={c.is_active ? "Deactivate" : "Activate"} onClick={() => toggle(c)}><Power className={`size-4 ${c.is_active ? "text-red-600" : "text-emerald-600"}`} /></Button>
                </div></td>
              </tr>
            ))}</tbody>
          </TableWrap>
          <Pagination page={page} pageSize={25} total={list.data?.total ?? 0} onChange={setPage} />
          </>}
        </Async>
      </Card>
      <GenerateModal open={gen} onClose={() => setGen(false)} defaultSession={current?.id} onDone={(r) => { setGen(false); setGenerated(r); refresh(); }} />
      <GeneratedModal batch={generated} onClose={() => setGenerated(null)} />
      <EditModal code={edit} onClose={() => setEdit(null)} onSaved={refresh} />
      <LogsModal code={logs} onClose={() => setLogs(null)} />
    </>
  );
}

function GenerateModal({ open, onClose, defaultSession, onDone }: { open: boolean; onClose: () => void; defaultSession?: number; onDone: (r: Rec) => void }) {
  const { sessions } = useLookups();
  const [qty, setQty] = useState("10");
  const [custom, setCustom] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [termId, setTermId] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expires, setExpires] = useState("");
  const [studentQ, setStudentQ] = useState("");
  const dq = useDebounced(studentQ);
  const [student, setStudent] = useState<Rec | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const found = useFetch(() => get<Paged>("/api/students", { q: dq, page_size: 6 }), [dq], open && dq.length >= 2 && !student);

  useEffect(() => { if (open) { setError(null); setStudent(null); setStudentQ(""); setSessionId(defaultSession ? String(defaultSession) : ""); setTermId(""); } }, [open, defaultSession]);
  const terms: Rec[] = sessions.find((s) => String(s.id) === sessionId)?.terms ?? [];
  const n = qty === "custom" ? Number(custom) : Number(qty);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post<Rec>("/api/result-codes/generate", { quantity: student ? 1 : n, session_id: Number(sessionId), term_id: termId ? Number(termId) : null, student_id: student?.id ?? null, max_uses: maxUses ? Number(maxUses) : null, expires_at: expires ? toIso(expires + "T23:59:59") : null });
      onDone(res);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Generate result codes" size="md" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="gen-form" loading={busy} disabled={!sessionId || (!student && !(n >= 1 && n <= 1000))}>Generate {student ? 1 : n || ""} code{(student ? 1 : n) === 1 ? "" : "s"}</Button></>}>
      <form id="gen-form" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Quantity">
          <div className="flex flex-wrap gap-2">{["1", "10", "100", "custom"].map((v) => <button type="button" key={v} disabled={!!student} onClick={() => setQty(v)} className={`rounded-lg px-4 py-2 text-sm font-semibold ring-1 ${qty === v && !student ? "bg-brand-700 text-white ring-brand-700" : "bg-white ring-line"} disabled:opacity-40`}>{v === "custom" ? "Custom" : v}</button>)}
            {qty === "custom" && !student && <Input type="number" min={1} max={1000} className="w-28" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="1–1000" aria-label="Custom quantity" />}</div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Session" required><Select required value={sessionId} onChange={(e) => { setSessionId(e.target.value); setTermId(""); }}><option value="">Select…</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Term" hint="Leave on 'Any term' for a session-wide card"><Select value={termId} onChange={(e) => setTermId(e.target.value)} disabled={!terms.length}><option value="">Any term</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <Field label="Allowed uses" hint="Blank = school default"><Input type="number" min={1} max={100} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} /></Field>
          <Field label="Expires on" hint="Blank = school default"><Input type="date" min={new Date().toISOString().slice(0, 10)} value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
        </div>
        <Field label="Assign to a student (optional)" hint="Assigned codes work only for that student and are generated one at a time.">
          {student ? <div className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm"><span><b>{student.full_name}</b> <span className="font-mono text-xs">{student.student_no}</span></span><button type="button" className="font-semibold text-brand-700" onClick={() => setStudent(null)}>Remove</button></div> : (
            <div className="relative"><Input value={studentQ} onChange={(e) => setStudentQ(e.target.value)} placeholder="Search student name or ID…" />
              {dq.length >= 2 && found.data && <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-line bg-white shadow-lg">{found.data.items.length ? found.data.items.map((s) => <li key={s.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-brand-50" onClick={() => setStudent(s)}>{s.full_name} <span className="font-mono text-xs text-muted">{s.student_no}</span></button></li>) : <li className="px-3 py-2 text-sm text-muted">No matches</li>}</ul>}</div>
          )}
        </Field>
      </form>
    </Modal>
  );
}

function GeneratedModal({ batch, onClose }: { batch: Rec | null; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!batch) return null;
  const codes: Rec[] = batch.codes;

  function csv() {
    const rows = [["Serial", "PIN", "Session", "Term", "Allowed uses", "Expires"], ...codes.map((c) => [c.serial, c.pin, c.session, c.term, c.max_uses, c.expires_at ?? "Never"])];
    downloadText(`result-codes-${batch!.batch_ref}.csv`, rows.map((r) => r.map(csvEscape).join(",")).join("\r\n"));
  }
  async function pdf() {
    setBusy(true);
    try {
      await postForFile("/api/result-codes/cards.pdf", { cards: codes.map((c) => ({ serial: c.serial, pin: c.pin })) }, `result-cards-${batch!.batch_ref}.pdf`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <Modal open onClose={onClose} title={`${batch.count} code${batch.count === 1 ? "" : "s"} generated`} size="lg" footer={<><Button variant="outline" onClick={csv}><Download className="size-4" /> CSV</Button><Button variant="outline" onClick={pdf} loading={busy}><FileText className="size-4" /> Cards PDF</Button><Button onClick={printCards}><Printer className="size-4" /> Print cards</Button></>}>
        <Alert tone="warn" className="mb-4"><b>Save these PINs now.</b> For security only a one-way hash is stored, so the PINs cannot be shown again after you close this window. Batch reference: <span className="font-mono">{batch.batch_ref}</span></Alert>
        <div className="max-h-80 overflow-auto rounded-xl border border-line">
          <table className="w-full text-sm"><thead className="sticky top-0 bg-stone-50"><tr><th className="th">Serial</th><th className="th">Access PIN</th><th className="th">Term</th></tr></thead>
            <tbody>{codes.map((c) => <tr key={c.serial} className="border-t border-line"><td className="td font-mono text-xs">{c.serial}</td><td className="td font-mono font-bold tracking-wider">{c.pin}</td><td className="td text-xs">{c.term}</td></tr>)}</tbody></table>
        </div>
      </Modal>
      <PrintableCards cards={codes} />
    </>
  );
}

function EditModal({ code, onClose, onSaved }: { code: Rec | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [maxUses, setMaxUses] = useState("");
  const [expires, setExpires] = useState("");
  const [studentQ, setStudentQ] = useState("");
  const dq = useDebounced(studentQ);
  const [student, setStudent] = useState<Rec | null>(null);
  const [clearStudent, setClearStudent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const found = useFetch(() => get<Paged>("/api/students", { q: dq, page_size: 6 }), [dq], !!code && dq.length >= 2 && !student);
  useEffect(() => { if (code) { setError(null); setMaxUses(String(code.max_uses)); setExpires(code.expires_at ? code.expires_at.slice(0, 10) : ""); setStudent(null); setStudentQ(""); setClearStudent(false); } }, [code]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await put(`/api/result-codes/${code!.id}`, { max_uses: Number(maxUses), ...(expires ? { expires_at: toIso(expires + "T23:59:59") } : { clear_expiry: true }), ...(student ? { student_id: student.id } : {}), ...(clearStudent ? { clear_student: true } : {}) });
      toast.success("Code updated"); onSaved(); onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open={!!code} onClose={onClose} title={`Edit ${code?.serial ?? ""}`} size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      {code && <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3"><Field label="Allowed uses" hint={`${code.use_count} used so far`}><Input type="number" min={Math.max(1, code.use_count)} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} /></Field><Field label="Expires on" hint="Clear to never expire"><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field></div>
        <Field label="Assigned student" hint={code.student ? `Currently: ${code.student}` : "Currently unassigned"}>
          {student ? <div className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm"><b>{student.full_name}</b><button className="font-semibold text-brand-700" onClick={() => setStudent(null)}>Remove</button></div> : (
            <div className="relative"><Input value={studentQ} onChange={(e) => setStudentQ(e.target.value)} placeholder="Search to (re)assign…" />
              {dq.length >= 2 && found.data && <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-auto rounded-lg border border-line bg-white shadow-lg">{found.data.items.map((s) => <li key={s.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-brand-50" onClick={() => setStudent(s)}>{s.full_name} <span className="font-mono text-xs text-muted">{s.student_no}</span></button></li>)}</ul>}</div>
          )}
          {code.student && code.use_count === 0 && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={clearStudent} onChange={(e) => setClearStudent(e.target.checked)} /> Unassign from student</label>}
        </Field>
      </div>}
    </Modal>
  );
}

function LogsModal({ code, onClose }: { code: Rec | null; onClose: () => void }) {
  const { data, loading, error, reload } = useFetch(() => get<Rec[]>(`/api/result-codes/${code!.id}/logs`), [code?.id], !!code);
  return (
    <Modal open={!!code} onClose={onClose} title={`Usage history — ${code?.serial ?? ""}`} size="lg">
      <Card className="border-0 shadow-none">
        <CardHeader title={code ? `${code.use_count} of ${code.max_uses} uses · ${code.status.toLowerCase()}` : ""} />
        <Async loading={loading} error={error} onRetry={reload} empty={!data?.length} emptyNode={<EmptyState title="No access attempts yet" />}>
          <TableWrap><thead className="bg-stone-50"><tr><th className="th">When</th><th className="th">Outcome</th><th className="th">Student ref</th><th className="th">IP</th><th className="th">Device</th></tr></thead>
            <tbody>{data?.map((l) => <tr key={l.id} className="border-t border-line"><td className="td text-xs">{fmtDateTime(l.created_at)}</td><td className="td">{l.success ? <Badge tone="green">Success</Badge> : <Badge tone="red">{String(l.reason ?? "Failed").replace(/_/g, " ")}</Badge>}</td><td className="td font-mono text-xs">{l.student_ref}</td><td className="td font-mono text-xs">{l.ip}</td><td className="td max-w-48 truncate text-xs text-muted" title={l.user_agent}>{l.user_agent}</td></tr>)}</tbody></TableWrap>
        </Async>
      </Card>
    </Modal>
  );
}
