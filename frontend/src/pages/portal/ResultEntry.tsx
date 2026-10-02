import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ClipboardList, Save, Send } from "lucide-react";
import { get, post, type Paged, type Rec } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFetch, useToast } from "@/lib/hooks";
import { useLookups } from "@/lib/lookups";
import { cn, fmtNum, gradeColor } from "@/lib/utils";
import { Alert, Async, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, StatusBadge, TableWrap, Tabs, useConfirm } from "@/components/ui";

interface Line { ca: string; exam: string; remark: string; dirty: boolean }

function gradeOf(entries: Rec[], total: number) {
  const sorted = [...entries].sort((a, b) => b.min_score - a.min_score);
  return sorted.find((e) => total >= e.min_score && total <= e.max_score) ?? sorted.find((e) => total >= e.min_score);
}

export default function ResultEntry() {
  const [tab, setTab] = useState<"sheet" | "list">("sheet");
  return (
    <>
      <PageHeader title="Results" description="Enter scores, save drafts, then submit for approval. Published results can only be changed through an amendment." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "sheet", label: "Entry sheet" }, { id: "list", label: "All results" }]} />
      {tab === "sheet" ? <Sheet /> : <ResultList />}
    </>
  );
}

function Sheet() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [params] = useSearchParams();
  const { sessions, classes, subjects, currentTerm, current, loading: lookupsLoading } = useLookups();
  const overview = useFetch(() => get<Rec>("/api/teachers/me/overview"), [], user?.role === "TEACHER");
  const scale = useFetch(() => get<Rec>("/api/grading-scale"), []);
  const [termId, setTermId] = useState("");
  const [classId, setClassId] = useState(params.get("class_id") ?? "");
  const [armId, setArmId] = useState(params.get("arm_id") ?? "");
  const [subjectId, setSubjectId] = useState(params.get("subject_id") ?? "");
  const [lines, setLines] = useState<Record<number, Line>>({});
  const [busy, setBusy] = useState<"" | "save" | "submit">("");
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => { if (!termId && currentTerm) setTermId(String(currentTerm.id)); }, [currentTerm, termId]);

  const isTeacher = user?.role === "TEACHER";
  const assignments: Rec[] = overview.data?.assignments ?? [];
  const classOptions = isTeacher ? classes.filter((c) => assignments.some((a) => a.class_id === c.id)) : classes;
  const arms: Rec[] = classes.find((c) => String(c.id) === classId)?.arms ?? [];
  const subjectOptions = isTeacher
    ? subjects.filter((s) => assignments.some((a) => a.subject_id === s.id && String(a.class_id) === classId && (!a.arm_id || !armId || String(a.arm_id) === armId)))
    : subjects.filter((s) => s.is_active);
  const ready = !!(termId && classId && subjectId);
  const terms: Rec[] = useMemo(() => sessions.flatMap((s) => s.terms.map((t: Rec) => ({ ...t, label: `${s.name} · ${t.name}` }))), [sessions]);

  const sheet = useFetch(() => get<Rec>("/api/results/sheet", { term_id: termId, class_id: classId, arm_id: armId, subject_id: subjectId }), [termId, classId, armId, subjectId], ready);

  useEffect(() => {
    if (!sheet.data) return;
    const m: Record<number, Line> = {};
    for (const r of sheet.data.rows) m[r.enrollment_id] = { ca: r.ca_score ?? "", exam: r.exam_score ?? "", remark: r.teacher_remark ?? "", dirty: false };
    setLines(m);
    setProblems([]);
  }, [sheet.data]);

  const rows: Rec[] = sheet.data?.rows ?? [];
  const editable = (r: Rec) => r.status === "NOT_STARTED" || r.status === "DRAFT";
  const dirtyCount = rows.filter((r) => lines[r.enrollment_id]?.dirty && editable(r)).length;
  const submittable = rows.filter((r) => r.status === "DRAFT" && !lines[r.enrollment_id]?.dirty).length;

  function setLine(id: number, patch: Partial<Line>) { setLines((l) => ({ ...l, [id]: { ...l[id], ...patch, dirty: true } })); }

  function validate() {
    const errs: string[] = [];
    for (const r of rows) {
      const l = lines[r.enrollment_id];
      if (!l || !l.dirty || !editable(r)) continue;
      const ca = l.ca === "" ? 0 : Number(l.ca), ex = l.exam === "" ? 0 : Number(l.exam);
      if (Number.isNaN(ca) || ca < 0 || ca > sheet.data!.ca_max) errs.push(`${r.student_name}: CA must be between 0 and ${sheet.data!.ca_max}`);
      if (Number.isNaN(ex) || ex < 0 || ex > sheet.data!.exam_max) errs.push(`${r.student_name}: Exam must be between 0 and ${sheet.data!.exam_max}`);
    }
    setProblems(errs);
    return errs.length === 0;
  }

  async function save(): Promise<boolean> {
    if (!validate()) return false;
    const payload = rows.filter((r) => lines[r.enrollment_id]?.dirty && editable(r)).map((r) => {
      const l = lines[r.enrollment_id];
      return { enrollment_id: r.enrollment_id, ca_score: l.ca === "" ? null : Number(l.ca), exam_score: l.exam === "" ? null : Number(l.exam), teacher_remark: l.remark || null };
    });
    if (!payload.length) return true;
    const res = await post<Rec>("/api/results/bulk", { subject_id: Number(subjectId), term_id: Number(termId), lines: payload });
    if (res.skipped.length) setProblems(res.skipped.map((s: Rec) => `${s.student ?? "Student"}: ${s.reason}`));
    toast.success(`${res.saved} result(s) saved as draft`);
    return true;
  }

  async function onSave() {
    setBusy("save");
    try { if (await save()) sheet.reload(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  }

  async function onSubmit() {
    if (!(await confirm({ title: "Submit results?", message: "Submitted results are locked for editing until an administrator returns them or approves them.", confirmLabel: "Submit" }))) return;
    setBusy("submit");
    try {
      if (!(await save())) return;
      const fresh = await get<Rec>("/api/results/sheet", { term_id: termId, class_id: classId, arm_id: armId, subject_id: subjectId });
      const ids = fresh.rows.filter((r: Rec) => r.status === "DRAFT" && r.result_id).map((r: Rec) => r.result_id);
      if (!ids.length) { toast.error("There are no draft results to submit."); sheet.reload(); return; }
      const res = await post<Rec>("/api/results/batch/submit", { ids });
      if (res.failed.length) setProblems(res.failed.map((f: Rec) => `Result ${f.id}: ${f.reason}`));
      toast.success(`${res.done} result(s) submitted`);
      sheet.reload();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  }

  return (
    <>
      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Term"><Select value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">Select…</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
          <Field label="Class"><Select value={classId} onChange={(e) => { setClassId(e.target.value); setArmId(""); setSubjectId(""); }}><option value="">Select…</option>{classOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Arm"><Select value={armId} onChange={(e) => setArmId(e.target.value)} disabled={!arms.length}><option value="">All arms</option>{arms.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <Field label="Subject"><Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={!classId}><option value="">Select…</option>{subjectOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        </div>
        {isTeacher && !overview.loading && !assignments.length && <Alert tone="warn" className="mt-4">You have no class or subject assignments for {current?.name ?? "this session"}. Ask an administrator to assign them.</Alert>}
      </Card>

      {!ready ? (
        <Card><EmptyState icon={<ClipboardList className="size-7" />} title="Choose a term, class and subject" description="The list of students will appear here." /></Card>
      ) : (
        <Card>
          <Async loading={sheet.loading || lookupsLoading} error={sheet.error} onRetry={sheet.reload} empty={!rows.length} emptyNode={<EmptyState title="No active students in this class" description="Register or enrol students into this class for the selected session." />}>
            {problems.length > 0 && <div className="p-4 pb-0"><Alert tone="error"><ul className="list-disc pl-5">{problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}</ul></Alert></div>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
              <div className="text-sm text-muted"><b className="text-ink">{sheet.data?.subject}</b> · {sheet.data?.term} · CA out of <b>{sheet.data?.ca_max}</b>, Exam out of <b>{sheet.data?.exam_max}</b></div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onSave} loading={busy === "save"} disabled={!dirtyCount || !!busy}><Save className="size-4" /> Save draft{dirtyCount ? ` (${dirtyCount})` : ""}</Button>
                <Button size="sm" onClick={onSubmit} loading={busy === "submit"} disabled={(!submittable && !dirtyCount) || !!busy}><Send className="size-4" /> Submit for approval</Button>
              </div>
            </div>
            <TableWrap>
              <thead className="bg-stone-50"><tr><th className="th">#</th><th className="th">Student</th><th className="th w-24">CA</th><th className="th w-24">Exam</th><th className="th w-20">Total</th><th className="th w-20">Grade</th><th className="th min-w-48">Remark</th><th className="th">Status</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const l = lines[r.enrollment_id] ?? { ca: "", exam: "", remark: "", dirty: false };
                  const ed = editable(r);
                  const hasScores = l.ca !== "" || l.exam !== "";
                  const total = (Number(l.ca) || 0) + (Number(l.exam) || 0);
                  const g = hasScores && scale.data ? gradeOf(scale.data.entries, total) : null;
                  const badCa = l.ca !== "" && (Number(l.ca) > sheet.data!.ca_max || Number(l.ca) < 0);
                  const badEx = l.exam !== "" && (Number(l.exam) > sheet.data!.exam_max || Number(l.exam) < 0);
                  return (
                    <tr key={r.enrollment_id} className={cn("border-t border-line", l.dirty && "bg-amber-50/50")}>
                      <td className="td text-muted">{i + 1}</td>
                      <td className="td"><div className="font-semibold">{r.student_name}</div><div className="font-mono text-xs text-muted">{r.student_no}</div>{r.rejection_reason && r.status === "DRAFT" && <div className="mt-1 text-xs font-medium text-red-700">Returned: {r.rejection_reason}</div>}</td>
                      <td className="td"><Input type="number" inputMode="decimal" min={0} max={sheet.data!.ca_max} step="0.5" disabled={!ed} value={l.ca} onChange={(e) => setLine(r.enrollment_id, { ca: e.target.value })} aria-label={`CA score for ${r.student_name}`} className={cn("h-10 w-20 text-center", badCa && "border-red-500")} /></td>
                      <td className="td"><Input type="number" inputMode="decimal" min={0} max={sheet.data!.exam_max} step="0.5" disabled={!ed} value={l.exam} onChange={(e) => setLine(r.enrollment_id, { exam: e.target.value })} aria-label={`Exam score for ${r.student_name}`} className={cn("h-10 w-20 text-center", badEx && "border-red-500")} /></td>
                      <td className="td font-bold tabular-nums">{hasScores ? fmtNum(total) : "—"}</td>
                      <td className="td">{g ? <span className={cn("inline-block min-w-7 rounded px-1.5 py-0.5 text-center text-xs font-bold", gradeColor(g.grade))}>{g.grade}</span> : "—"}</td>
                      <td className="td"><Input disabled={!ed} value={l.remark} maxLength={300} onChange={(e) => setLine(r.enrollment_id, { remark: e.target.value })} aria-label={`Remark for ${r.student_name}`} className="h-10" placeholder="Optional" /></td>
                      <td className="td"><StatusBadge status={r.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </Async>
        </Card>
      )}
    </>
  );
}

function ResultList() {
  const { can } = useAuth();
  const toast = useToast();
  const { classes, subjects, sessions, current } = useLookups();
  const [filters, setFilters] = useState({ term_id: "", class_id: "", subject_id: "", status: "", q: "" });
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch(() => get<Paged>("/api/results", { ...filters, page, page_size: 25 }), [filters, page]);
  const [amend, setAmend] = useState<Rec | null>(null);
  const [f, setF] = useState({ ca: "", exam: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const terms: Rec[] = (sessions.find((s) => s.id === current?.id)?.terms ?? []);
  const setFilter = (k: string, v: string) => { setFilters({ ...filters, [k]: v }); setPage(1); };

  function openAmend(r: Rec) { setAmend(r); setF({ ca: String(r.ca_score), exam: String(r.exam_score), reason: "" }); setErr(null); }
  async function submitAmend() {
    setBusy(true);
    try { const res = await post<Rec>(`/api/results/${amend!.id}/amendments`, { ca_score: Number(f.ca), exam_score: Number(f.exam), reason: f.reason }); toast.success(res.status === "APPROVED" ? "Correction applied and recorded in the audit log" : "Amendment request sent for approval"); setAmend(null); reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Card>
      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Input type="search" placeholder="Search student…" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} aria-label="Search student" />
        <Select value={filters.term_id} onChange={(e) => setFilter("term_id", e.target.value)} aria-label="Term"><option value="">{current?.name ?? "Current"} · all terms</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <Select value={filters.class_id} onChange={(e) => setFilter("class_id", e.target.value)} aria-label="Class"><option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select value={filters.subject_id} onChange={(e) => setFilter("subject_id", e.target.value)} aria-label="Subject"><option value="">All subjects</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select value={filters.status} onChange={(e) => setFilter("status", e.target.value)} aria-label="Status"><option value="">Any status</option>{["DRAFT", "SUBMITTED", "APPROVED", "PUBLISHED"].map((s) => <option key={s}>{s}</option>)}</Select>
      </div>
      <Async loading={loading} error={error} onRetry={reload} empty={!data?.items.length} emptyNode={<EmptyState title="No results found" description="Adjust the filters or enter results on the entry sheet." />}>
        <TableWrap>
          <thead className="bg-stone-50"><tr><th className="th">Student</th><th className="th">Class</th><th className="th">Subject</th><th className="th">CA</th><th className="th">Exam</th><th className="th">Total</th><th className="th">Grade</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody>{data!.items.map((r) => (
            <tr key={r.id} className="border-t border-line"><td className="td font-semibold">{r.student_name}<div className="font-mono text-xs font-normal text-muted">{r.student_no}</div></td><td className="td">{r.class_name}</td><td className="td">{r.subject}</td>
              <td className="td tabular-nums">{fmtNum(r.ca_score)}</td><td className="td tabular-nums">{fmtNum(r.exam_score)}</td><td className="td font-bold tabular-nums">{fmtNum(r.total)}</td>
              <td className="td"><span className={cn("rounded px-1.5 py-0.5 text-xs font-bold", gradeColor(r.grade))}>{r.grade}</span></td><td className="td"><StatusBadge status={r.status} />{r.version > 1 && <span className="ml-1 text-xs text-muted">v{r.version}</span>}</td>
              <td className="td text-right">{r.status === "PUBLISHED" && can("results.amend") && <Button size="sm" variant="outline" onClick={() => openAmend(r)}>Amend</Button>}</td></tr>
          ))}</tbody>
        </TableWrap>
        <Pagination page={page} pageSize={25} total={data?.total ?? 0} onChange={setPage} />
      </Async>
      <Modal open={!!amend} onClose={() => setAmend(null)} title="Amend published result" size="sm" footer={<><Button variant="outline" onClick={() => setAmend(null)}>Cancel</Button><Button onClick={submitAmend} loading={busy} disabled={f.reason.trim().length < 5}>Submit amendment</Button></>}>
        {amend && <div className="space-y-4">
          <Alert tone="info">Published results are never edited silently. This creates an amendment with an audit trail{can("results.amend_approve") ? " and applies it immediately" : " that an administrator must approve"}.</Alert>
          {err && <Alert tone="error">{err}</Alert>}
          <div className="text-sm"><b>{amend.student_name}</b> · {amend.subject}</div>
          <div className="grid grid-cols-2 gap-3"><Field label="CA score"><Input type="number" value={f.ca} onChange={(e) => setF({ ...f, ca: e.target.value })} /></Field><Field label="Exam score"><Input type="number" value={f.exam} onChange={(e) => setF({ ...f, exam: e.target.value })} /></Field></div>
          <Field label="Reason for correction" required><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={500} /></Field>
        </div>}
      </Modal>
    </Card>
  );
}
