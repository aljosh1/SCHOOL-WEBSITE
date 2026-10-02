import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Camera, FileText, Pencil, Power, Printer } from "lucide-react";
import { get, post, upload, type Rec } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAuthImage, useFetch, useToast } from "@/lib/hooks";
import { fmtDate } from "@/lib/utils";
import { Async, Button, Card, CardHeader, EmptyState, PageHeader, StatusBadge, useConfirm } from "@/components/ui";
import { StudentFormModal } from "./Students";

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="grid grid-cols-[9.5rem_1fr] gap-3 border-b border-line/60 py-2.5 text-sm last:border-0"><dt className="text-muted">{k}</dt><dd className="font-medium">{v || "—"}</dd></div>
);

export function StudentProfileView({ id, self }: { id: number | "me"; self?: boolean }) {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: s, loading, error, reload } = useFetch(() => get<Rec>(id === "me" ? "/api/students/me" : `/api/students/${id}`), [id]);
  const hist = useFetch(() => get<Rec[]>("/api/results/history", id === "me" ? undefined : { student_id: id }), [id]);
  const photo = useAuthImage(s?.photo_url);
  const [edit, setEdit] = useState(false);
  const canWrite = !self && can("students.write");

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !s) return;
    const fd = new FormData();
    fd.append("file", file);
    try { await upload(`/api/students/${s.id}/photo`, fd); toast.success("Photo updated"); reload(); } catch (err) { toast.error((err as Error).message); }
    e.target.value = "";
  }

  async function toggle() {
    if (!s) return;
    const deactivate = s.status === "ACTIVE";
    if (!(await confirm({ title: deactivate ? "Deactivate student?" : "Activate student?", message: deactivate ? `${s.full_name} will no longer be able to sign in. Records are kept.` : `${s.full_name} will be able to sign in again.`, confirmLabel: deactivate ? "Deactivate" : "Activate", danger: deactivate }))) return;
    try { await post(`/api/students/${s.id}/${deactivate ? "deactivate" : "activate"}`); toast.success("Status updated"); reload(); } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <Async loading={loading} error={error} onRetry={reload} rows={6}>
      {s && (
        <>
          <PageHeader title={s.full_name} description={`${s.student_no} · ${s.class_name ?? "No class assigned"}`}
            actions={<>
              {!self && <Link to="/portal/students" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-semibold hover:bg-brand-50"><ArrowLeft className="size-4" /> Back</Link>}
              <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
              {canWrite && <Button variant="outline" size="sm" onClick={() => setEdit(true)}><Pencil className="size-4" /> Edit</Button>}
              {canWrite && <Button variant={s.status === "ACTIVE" ? "danger" : "primary"} size="sm" onClick={toggle}><Power className="size-4" /> {s.status === "ACTIVE" ? "Deactivate" : "Activate"}</Button>}
            </>} />
          <div className="grid gap-5 lg:grid-cols-[300px_1fr] print-area">
            <Card className="h-fit p-6 text-center">
              <div className="mx-auto grid size-40 place-items-center overflow-hidden rounded-2xl bg-brand-100 font-display text-5xl font-bold text-brand-800">{photo ? <img src={photo} alt={`${s.full_name}'s photograph`} className="size-full object-cover" /> : s.first_name[0] + s.last_name[0]}</div>
              {canWrite && <label className="no-print mt-3 inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"><Camera className="size-4" /> Upload photo<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onPhoto} /></label>}
              <h2 className="mt-3 text-xl font-semibold">{s.full_name}</h2>
              <div className="mt-1 flex justify-center"><StatusBadge status={s.status} /></div>
              <div className="mt-4 rounded-xl bg-stone-50 p-3 text-left text-xs"><div className="text-muted">Student ID</div><div className="font-mono font-bold">{s.student_no}</div><div className="mt-2 text-muted">Admission no.</div><div className="font-mono font-bold">{s.admission_no}</div></div>
            </Card>
            <div className="space-y-5">
              <Card><CardHeader title="Personal & academic" /><dl className="px-5 py-2">
                <Row k="Class" v={s.class_name} /><Row k="Session" v={s.session} /><Row k="Gender" v={s.gender && s.gender[0] + s.gender.slice(1).toLowerCase()} /><Row k="Date of birth" v={fmtDate(s.date_of_birth)} />
                <Row k="Admission date" v={fmtDate(s.admission_date)} /><Row k="State of origin" v={s.state_of_origin} /><Row k="Religion" v={s.religion} /><Row k="Blood group" v={s.blood_group} />
                <Row k="Address" v={s.address} /><Row k="Previous school" v={s.previous_school} />{!self && <Row k="Medical notes" v={s.medical_notes} />}
              </dl></Card>
              <Card><CardHeader title="Parent / guardian" /><dl className="px-5 py-2"><Row k="Name" v={s.parent_name} /><Row k="Relationship" v={s.parent_relationship} /><Row k="Phone" v={s.parent_phone} /><Row k="Email" v={s.parent_email} /><Row k="Address" v={s.parent_address} /></dl></Card>
              <Card><CardHeader title="Emergency contact" /><dl className="px-5 py-2"><Row k="Name" v={s.emergency_name} /><Row k="Phone" v={s.emergency_phone} /><Row k="Relationship" v={s.emergency_relationship} /></dl></Card>
              <Card className="no-print">
                <CardHeader title="Class history" />
                {s.history?.length ? <ul className="divide-y divide-line">{s.history.map((h: Rec) => <li key={h.session} className="flex justify-between px-5 py-3 text-sm"><span className="font-semibold">{h.session}</span><span>{h.class_name}</span></li>)}</ul> : <EmptyState title="No enrolment history" />}
              </Card>
              {!self && (
                <Card className="no-print">
                  <CardHeader title="Published results" />
                  <Async loading={hist.loading} error={hist.error} onRetry={hist.reload} empty={!hist.data?.length} emptyNode={<EmptyState icon={<FileText className="size-7" />} title="No published results" />}>
                    <ul className="divide-y divide-line">{hist.data?.flatMap((x) => x.terms.map((t: Rec) => <li key={t.card_id} className="flex items-center justify-between px-5 py-3 text-sm"><span><b>{x.session}</b> · {t.term} · {t.class_name}</span><Link to={`/portal/report/${t.card_id}`} className="font-semibold text-brand-700 hover:underline">Average {t.average} · View</Link></li>))}</ul>
                  </Async>
                </Card>
              )}
            </div>
          </div>
          {canWrite && <StudentFormModal open={edit} onClose={() => setEdit(false)} student={s} onSaved={reload} />}
        </>
      )}
    </Async>
  );
}

export default function StudentProfile() {
  const { id } = useParams();
  return <StudentProfileView id={Number(id)} />;
}
