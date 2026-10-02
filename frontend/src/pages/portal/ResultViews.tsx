import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, FileText, Printer } from "lucide-react";
import { get, put, saveFile, type Rec } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFetch, useToast } from "@/lib/hooks";
import { useSchool } from "@/lib/school";
import { Alert, Async, Button, Card, CardHeader, EmptyState, PageHeader, Textarea } from "@/components/ui";
import { ResultSheet } from "@/components/ResultSheet";

/** Report card for an authorised user, by report-card id. */
export function ReportView({ cardId, backTo }: { cardId: number; backTo?: string }) {
  const toast = useToast();
  const { isStaffAdmin, user } = useAuth();
  const { school } = useSchool();
  const { data, loading, error, reload } = useFetch(() => get<Rec>(`/api/report-cards/${cardId}`), [cardId]);
  const [teacher, setTeacher] = useState("");
  const [principal, setPrincipal] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) { setTeacher(data.teacher_remark ?? ""); setPrincipal(data.principal_remark ?? ""); } }, [data]);

  async function saveRemarks() {
    setSaving(true);
    try {
      await put(`/api/report-cards/${cardId}/remarks`, isStaffAdmin ? { teacher_remark: teacher, principal_remark: principal } : { teacher_remark: teacher });
      toast.success("Remarks saved");
      reload();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <Async loading={loading} error={error} onRetry={reload} rows={6}>
      {data && school && (
        <>
          <PageHeader title={`${data.term} report`} description={`${data.student.name} · ${data.class_name} · ${data.session}`}
            actions={<>
              {backTo && <Link to={backTo} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-semibold"><ArrowLeft className="size-4" /> Back</Link>}
              <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
              <Button size="sm" onClick={() => saveFile(`/api/report-cards/${cardId}/pdf`, "result.pdf").catch((e) => toast.error(e.message))}><Download className="size-4" /> Download PDF</Button>
            </>} />
          <ResultSheet report={data} school={school} protectedPhoto={data.student.photo_url} />
          {user?.role !== "STUDENT" && (
            <Card className="no-print mx-auto mt-6 max-w-4xl">
              <CardHeader title="Remarks" description="Leave blank to use the automatic remark for the overall grade." />
              <div className="space-y-4 p-5">
                <div><label className="field-label">Class teacher's remark</label><Textarea rows={2} maxLength={400} value={teacher} onChange={(e) => setTeacher(e.target.value)} /></div>
                {isStaffAdmin && <div><label className="field-label">Principal's remark</label><Textarea rows={2} maxLength={400} value={principal} onChange={(e) => setPrincipal(e.target.value)} /></div>}
                <Button onClick={saveRemarks} loading={saving}>Save remarks</Button>
              </div>
            </Card>
          )}
        </>
      )}
    </Async>
  );
}

export function ReportPage() {
  const { cardId } = useParams();
  return <ReportView cardId={Number(cardId)} backTo="/portal/students" />;
}

/** Student/parent view: academic history with session & term selection. */
export default function MyResults() {
  const [params, setParams] = useSearchParams();
  const hist = useFetch(() => get<Rec[]>("/api/results/history"), []);
  const [sessionName, setSessionName] = useState("");
  const [cardId, setCardId] = useState<number | null>(params.get("card") ? Number(params.get("card")) : null);

  const sessions = hist.data ?? [];
  useEffect(() => {
    if (cardId || !sessions.length) return;
    setSessionName(sessions[0].session);
    setCardId(sessions[0].terms[0].card_id);
  }, [sessions, cardId]);
  useEffect(() => {
    if (!cardId || !sessions.length) return;
    const owner = sessions.find((s) => s.terms.some((t: Rec) => t.card_id === cardId));
    if (owner) setSessionName(owner.session);
  }, [cardId, sessions]);

  const terms: Rec[] = sessions.find((s) => s.session === sessionName)?.terms ?? [];

  return (
    <>
      <PageHeader title="My results" description="Select a session and term to view, print or download your result." />
      <Async loading={hist.loading} error={hist.error} onRetry={hist.reload} empty={!sessions.length}
        emptyNode={<Card><EmptyState icon={<FileText className="size-7" />} title="No published results yet" description="Results appear here as soon as the school publishes them. If you hold a result-checking card you can also use the public Check Result page." action={<Link to="/check-result" className="font-semibold text-brand-700 underline">Check result with a card</Link>} /></Card>}>
        <Card className="no-print mb-6 p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div><label className="field-label">Session</label>
              <select className="input w-44" value={sessionName} onChange={(e) => { const s = sessions.find((x) => x.session === e.target.value)!; setSessionName(s.session); setCardId(s.terms[0].card_id); setParams({}); }}>{sessions.map((s) => <option key={s.session}>{s.session}</option>)}</select></div>
            <div className="flex flex-wrap gap-2">{terms.map((t) => <Button key={t.card_id} variant={cardId === t.card_id ? "primary" : "outline"} onClick={() => setCardId(t.card_id)}>{t.term}</Button>)}</div>
          </div>
        </Card>
        {cardId ? <ReportView cardId={cardId} /> : <Alert tone="info">Select a term.</Alert>}
      </Async>
    </>
  );
}
