import { useState } from "react";
import { CheckCircle2, ClipboardCheck, Send, Undo2 } from "lucide-react";
import { get, post, type Paged, type Rec } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFetch, useToast } from "@/lib/hooks";
import { useLookups } from "@/lib/lookups";
import { cn, fmtDateTime, fmtNum, gradeColor } from "@/lib/utils";
import { Alert, Async, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, StatusBadge, TableWrap, Tabs, Textarea, useConfirm } from "@/components/ui";

export default function Approvals() {
  const toast = useToast();
  const confirm = useConfirm();
  const { classes, subjects, sessions, current } = useLookups();
  const [tab, setTab] = useState<"SUBMITTED" | "APPROVED">("SUBMITTED");
  const [f, setF] = useState({ term_id: "", class_id: "", subject_id: "" });
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const terms: Rec[] = sessions.find((s) => s.id === current?.id)?.terms ?? [];
  const { data, loading, error, reload } = useFetch(() => get<Paged>("/api/results", { ...f, status: tab, page, page_size: 50 }), [f, tab, page]);
  const items = data?.items ?? [];
  const all = items.length > 0 && items.every((r) => sel.includes(r.id));

  async function run(action: "approve" | "publish" | "reject") {
    setBusy(true);
    setProblems([]);
    try {
      const res = await post<Rec>(`/api/results/batch/${action}`, { ids: sel, reason: action === "reject" ? reason : undefined });
      toast.success(`${res.done} result(s) ${action === "approve" ? "approved" : action === "publish" ? "published" : "returned to the teacher"}`);
      if (res.failed.length) setProblems(res.failed.map((x: Rec) => `Result ${x.id}: ${x.reason}`));
      setSel([]); setReturning(false); setReason(""); reload();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function publish() {
    if (await confirm({ title: `Publish ${sel.length} result(s)?`, message: "Students and parents will be able to see these results immediately and will be notified.", confirmLabel: "Publish" })) await run("publish");
  }

  return (
    <>
      <PageHeader title="Result approvals" description="Review submitted results, approve them, and publish them to students." />
      <Tabs value={tab} onChange={(t) => { setTab(t); setSel([]); setPage(1); }} tabs={[{ id: "SUBMITTED", label: "Awaiting approval" }, { id: "APPROVED", label: "Approved — ready to publish" }]} />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <Select className="w-44" value={f.term_id} onChange={(e) => { setF({ ...f, term_id: e.target.value }); setPage(1); }} aria-label="Term"><option value="">All terms</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          <Select className="w-40" value={f.class_id} onChange={(e) => { setF({ ...f, class_id: e.target.value }); setPage(1); }} aria-label="Class"><option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select className="w-48" value={f.subject_id} onChange={(e) => { setF({ ...f, subject_id: e.target.value }); setPage(1); }} aria-label="Subject"><option value="">All subjects</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <div className="ml-auto flex flex-wrap gap-2">
            {tab === "SUBMITTED" && <Button size="sm" disabled={!sel.length || busy} loading={busy} onClick={() => run("approve")}><CheckCircle2 className="size-4" /> Approve ({sel.length})</Button>}
            {tab === "APPROVED" && <Button size="sm" disabled={!sel.length || busy} onClick={publish}><Send className="size-4" /> Publish ({sel.length})</Button>}
            <Button size="sm" variant="outline" disabled={!sel.length || busy} onClick={() => setReturning(true)}><Undo2 className="size-4" /> Return to teacher</Button>
          </div>
        </div>
        {problems.length > 0 && <div className="p-4 pb-0"><Alert tone="error"><ul className="list-disc pl-5">{problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}</ul></Alert></div>}
        <Async loading={loading} error={error} onRetry={reload} empty={!items.length} emptyNode={<EmptyState icon={<ClipboardCheck className="size-7" />} title={tab === "SUBMITTED" ? "Nothing awaiting approval" : "Nothing ready to publish"} description="Results appear here after teachers submit them." />}>
          <TableWrap>
            <thead className="bg-stone-50"><tr><th className="th w-10"><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? [] : items.map((r) => r.id))} /></th><th className="th">Student</th><th className="th">Class</th><th className="th">Subject</th><th className="th">CA</th><th className="th">Exam</th><th className="th">Total</th><th className="th">Grade</th><th className="th">Submitted</th></tr></thead>
            <tbody>{items.map((r) => (
              <tr key={r.id} className="border-t border-line"><td className="td"><input type="checkbox" aria-label={`Select ${r.student_name} ${r.subject}`} checked={sel.includes(r.id)} onChange={() => setSel(sel.includes(r.id) ? sel.filter((x) => x !== r.id) : [...sel, r.id])} /></td>
                <td className="td font-semibold">{r.student_name}</td><td className="td">{r.class_name}</td><td className="td">{r.subject}</td><td className="td tabular-nums">{fmtNum(r.ca_score)}</td><td className="td tabular-nums">{fmtNum(r.exam_score)}</td><td className="td font-bold tabular-nums">{fmtNum(r.total)}</td>
                <td className="td"><span className={cn("rounded px-1.5 py-0.5 text-xs font-bold", gradeColor(r.grade))}>{r.grade}</span></td><td className="td text-xs text-muted">{fmtDateTime(r.submitted_at)}</td></tr>
            ))}</tbody>
          </TableWrap>
          <Pagination page={page} pageSize={50} total={data?.total ?? 0} onChange={setPage} />
        </Async>
      </Card>
      <Modal open={returning} onClose={() => setReturning(false)} title={`Return ${sel.length} result(s) to the teacher`} size="sm" footer={<><Button variant="outline" onClick={() => setReturning(false)}>Cancel</Button><Button variant="danger" onClick={() => run("reject")} loading={busy}>Return</Button></>}>
        <Field label="Reason (shown to the teacher)"><Textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Exam scores for 3 students look wrong." /></Field>
      </Modal>
    </>
  );
}

export function Amendments() {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState("PENDING");
  const { data, loading, error, reload } = useFetch(() => get<Rec[]>("/api/amendments", { status }), [status]);
  const [target, setTarget] = useState<{ a: Rec; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const approver = can("results.amend_approve");

  async function decide() {
    setBusy(true);
    try { await post(`/api/amendments/${target!.a.id}/${target!.approve ? "approve" : "reject"}`, { note: note || null }); toast.success(target!.approve ? "Amendment approved and applied" : "Amendment rejected"); setTarget(null); setNote(""); reload(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Result amendments" description="Corrections to published results. Every change is recorded in the audit log." />
      <Tabs value={status} onChange={setStatus} tabs={[{ id: "PENDING", label: "Pending" }, { id: "APPROVED", label: "Approved" }, { id: "REJECTED", label: "Rejected" }]} />
      <Card>
        <Async loading={loading} error={error} onRetry={reload} empty={!data?.length} emptyNode={<EmptyState title="No amendments" description="Corrections to published results will be listed here." />}>
          <TableWrap>
            <thead className="bg-stone-50"><tr><th className="th">Student</th><th className="th">Subject</th><th className="th">Change</th><th className="th">Reason</th><th className="th">Requested by</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>{data?.map((a) => (
              <tr key={a.id} className="border-t border-line"><td className="td font-semibold">{a.student_name}<div className="text-xs font-normal text-muted">{a.class_name}</div></td><td className="td">{a.subject}</td>
                <td className="td text-xs tabular-nums">CA {fmtNum(a.old_ca)} → <b>{fmtNum(a.new_ca)}</b><br />Exam {fmtNum(a.old_exam)} → <b>{fmtNum(a.new_exam)}</b></td><td className="td max-w-64 text-sm">{a.reason}{a.decision_note && <div className="text-xs text-muted">Note: {a.decision_note}</div>}</td>
                <td className="td text-xs">{a.requested_by}<div className="text-muted">{fmtDateTime(a.requested_at)}</div></td><td className="td"><StatusBadge status={a.status} /></td>
                <td className="td text-right">{approver && a.status === "PENDING" && <div className="flex justify-end gap-2"><Button size="sm" onClick={() => setTarget({ a, approve: true })}>Approve</Button><Button size="sm" variant="outline" onClick={() => setTarget({ a, approve: false })}>Reject</Button></div>}</td></tr>
            ))}</tbody>
          </TableWrap>
        </Async>
      </Card>
      <Modal open={!!target} onClose={() => setTarget(null)} title={target?.approve ? "Approve amendment" : "Reject amendment"} size="sm" footer={<><Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button><Button variant={target?.approve ? "primary" : "danger"} loading={busy} onClick={decide}>{target?.approve ? "Approve & apply" : "Reject"}</Button></>}>
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
      </Modal>
    </>
  );
}
