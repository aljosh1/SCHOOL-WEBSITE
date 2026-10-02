import { useEffect, useState } from "react";
import { PieChart } from "lucide-react";
import { get, type Rec } from "@/lib/api";
import { useFetch } from "@/lib/hooks";
import { useLookups } from "@/lib/lookups";
import { Alert, Async, Card, CardHeader, EmptyState, Field, PageHeader, Select, TableWrap } from "@/components/ui";
import { BarBox } from "@/components/charts";

export default function ClassReports() {
  const { sessions, classes, current } = useLookups();
  const [termId, setTermId] = useState("");
  const [classId, setClassId] = useState("");
  const [armId, setArmId] = useState("");
  const terms: Rec[] = sessions.flatMap((s) => s.terms.map((t: Rec) => ({ ...t, label: `${s.name} · ${t.name}` })));
  const arms: Rec[] = classes.find((c) => String(c.id) === classId)?.arms ?? [];
  useEffect(() => { if (!termId && current) setTermId(String((current.terms.find((t: Rec) => t.is_current) ?? current.terms[0])?.id ?? "")); }, [current, termId]);
  const ready = !!(termId && classId);
  const { data, loading, error, reload } = useFetch(() => get<Rec>("/api/reports/class-performance", { term_id: termId, class_id: classId, arm_id: armId }), [termId, classId, armId], ready);

  return (
    <>
      <PageHeader title="Class performance" description="Subject and student statistics from published results." />
      <Card className="mb-5 p-4"><div className="grid gap-3 sm:grid-cols-3">
        <Field label="Term"><Select value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">Select…</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
        <Field label="Class"><Select value={classId} onChange={(e) => { setClassId(e.target.value); setArmId(""); }}><option value="">Select…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Arm"><Select value={armId} onChange={(e) => setArmId(e.target.value)} disabled={!arms.length}><option value="">All arms</option>{arms.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
      </div></Card>
      {!ready ? <Card><EmptyState icon={<PieChart className="size-7" />} title="Choose a term and class" /></Card> : (
        <Async loading={loading} error={error} onRetry={reload} empty={!data?.subjects.length} emptyNode={<Card><EmptyState title="No published results" description="Statistics appear once results for this class are published." /></Card>}>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card><CardHeader title="Average score by subject" description={`Pass mark ${data?.pass_mark}`} /><div className="p-4"><BarBox data={data?.subjects.map((s: Rec) => ({ name: s.subject, value: s.average })) ?? []} color="#2563eb" /></div></Card>
            <Card><CardHeader title="Pass rate by subject (%)" /><div className="p-4"><BarBox data={data?.subjects.map((s: Rec) => ({ name: s.subject, value: s.pass_rate })) ?? []} color="#15803d" /></div></Card>
          </div>
          <Card className="mt-5"><CardHeader title="Subject performance" />
            <TableWrap><thead className="bg-stone-50"><tr><th className="th">Subject</th><th className="th">Students</th><th className="th">Average</th><th className="th">Highest</th><th className="th">Lowest</th><th className="th">Pass rate</th></tr></thead>
              <tbody>{data?.subjects.map((s: Rec) => <tr key={s.subject} className="border-t border-line"><td className="td font-semibold">{s.subject}</td><td className="td">{s.students}</td><td className="td tabular-nums">{s.average}</td><td className="td tabular-nums">{s.highest}</td><td className="td tabular-nums">{s.lowest}</td><td className="td tabular-nums">{s.pass_rate}%</td></tr>)}</tbody></TableWrap></Card>
          {data && data.ranking.length > 0 ? (
            <Card className="mt-5"><CardHeader title="Student ranking" description="By average across published subjects" />
              <TableWrap><thead className="bg-stone-50"><tr><th className="th">Position</th><th className="th">Student</th><th className="th">ID</th><th className="th">Average</th></tr></thead>
                <tbody>{data.ranking.map((r: Rec) => <tr key={r.student_no} className="border-t border-line"><td className="td font-bold">{r.position}</td><td className="td font-semibold">{r.student}</td><td className="td font-mono text-xs">{r.student_no}</td><td className="td tabular-nums">{r.average}</td></tr>)}</tbody></TableWrap></Card>
          ) : <Alert tone="info" className="mt-5">Rankings are available to administrators only.</Alert>}
        </Async>
      )}
    </>
  );
}
