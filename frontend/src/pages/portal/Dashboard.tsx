import { Link } from "react-router-dom";
import { Archive, BookOpen, CheckCircle2, ClipboardCheck, ClipboardList, Download, FileText, GraduationCap, History, Megaphone, Ticket, Upload, Users, UserSquare2 } from "lucide-react";
import { get, saveFile, type Rec } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAuthImage, useFetch, useToast } from "@/lib/hooks";
import { fmtDate, timeAgo } from "@/lib/utils";
import { Async, Badge, btn, Card, CardHeader, EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { BarBox, PieBox } from "@/components/charts";

export default function Dashboard() {
  const { user } = useAuth();
  if (user?.role === "TEACHER") return <TeacherDashboard />;
  if (user?.role === "STUDENT") return <StudentDashboard />;
  return <AdminDashboard />;
}

function AdminDashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch(() => get<Rec>("/api/dashboard"), []);
  const t = data?.totals ?? {};
  return (
    <>
      <PageHeader title={`Welcome, ${user?.full_name.split(" ")[0]}`} description={data ? `${data.session ?? "No session"} · ${data.term ?? "No current term"}` : undefined}
        actions={<><Link to="/portal/students?new=1" className={btn("primary", "sm")}>Register student</Link><Link to="/portal/codes" className={btn("outline", "sm")}>Result codes</Link></>} />
      <Async loading={loading} error={error} onRetry={reload} rows={6}>
        {data && <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Students" value={t.students} icon={<GraduationCap className="size-6" />} />
          <StatCard label="Teachers" value={t.teachers} icon={<Users className="size-6" />} tone="blue" />
          <StatCard label="Classes" value={t.classes} icon={<UserSquare2 className="size-6" />} tone="violet" />
          <StatCard label="Subjects" value={t.subjects} icon={<BookOpen className="size-6" />} tone="accent" />
          <StatCard label="Results awaiting approval" value={t.pending_results} icon={<ClipboardCheck className="size-6" />} tone="accent" hint="This term" />
          <StatCard label="Published results" value={t.published_results} icon={<CheckCircle2 className="size-6" />} hint="This term" />
          <StatCard label="Result codes generated" value={t.codes_generated} icon={<Ticket className="size-6" />} tone="violet" hint={`${t.codes_used} used · ${t.codes_available} available`} />
          <StatCard label="Learning materials" value={t.materials} icon={<Archive className="size-6" />} tone="blue" />
        </div>
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <Card><CardHeader title="Students per class" /><div className="p-4"><BarBox data={data!.charts.students_by_class} /></div></Card>
          <Card><CardHeader title="Result workflow status" description="Current term" /><div className="p-4"><BarBox data={data!.charts.results_by_status} color="#b45309" /></div></Card>
          <Card><CardHeader title="Grade distribution" description="Published results, current term" /><div className="p-4"><PieBox data={data!.charts.grade_distribution} grades /></div></Card>
          <Card><CardHeader title="Average score by subject" description="Published results, current term" /><div className="p-4"><BarBox data={data!.charts.subject_averages} color="#2563eb" horizontal height={Math.max(240, data!.charts.subject_averages.length * 34)} /></div></Card>
          <Card><CardHeader title="Result code usage" /><div className="p-4"><PieBox data={data!.charts.code_usage} /></div></Card>
          <Card>
            <CardHeader title="Recent activity" action={<Link to="/portal/audit" className="text-sm font-semibold text-brand-700 hover:underline">Audit log</Link>} />
            {data!.recent_activity.length ? (
              <ul className="divide-y divide-line">
                {data!.recent_activity.map((a: Rec) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><div className="min-w-0"><span className="font-semibold">{a.user ?? "System"}</span> <span className="text-muted">{a.action.replace(/_/g, " ").toLowerCase()}</span></div><span className="shrink-0 text-xs text-muted">{timeAgo(a.created_at)}</span></li>
                ))}
              </ul>
            ) : <EmptyState title="No activity yet" />}
          </Card>
        </div>
        </>}
      </Async>
    </>
  );
}

function TeacherDashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch(() => get<Rec>("/api/teachers/me/overview"), []);
  const r = data?.results ?? {};
  return (
    <>
      <PageHeader title={`Welcome, ${user?.full_name}`} description={data ? `${data.session ?? "No session"} · ${data.term ?? "No current term"}` : undefined} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["/portal/results", "Enter Result", ClipboardList], ["/portal/materials?new=1", "Upload Material", Upload], ["/portal/students", "View Students", Users], ["/portal/students", "My Classes", GraduationCap]].map(([to, label, Icon]: any) => (
          <Link key={label} to={to} className="card flex items-center gap-3 p-4 font-semibold transition hover:border-brand-400 hover:bg-brand-50"><span className="grid size-10 place-items-center rounded-lg bg-brand-700 text-white"><Icon className="size-5" /></span>{label}</Link>
        ))}
      </div>
      <Async loading={loading} error={error} onRetry={reload} rows={5}>
        {data && <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Students" value={data!.student_count} icon={<Users className="size-6" />} />
          <StatCard label="Pending (not submitted)" value={(r.NOT_STARTED ?? 0) + (r.DRAFT ?? 0)} icon={<ClipboardList className="size-6" />} tone="accent" hint="Not started + draft" />
          <StatCard label="Submitted" value={(r.SUBMITTED ?? 0) + (r.APPROVED ?? 0)} icon={<ClipboardCheck className="size-6" />} tone="blue" hint="Awaiting publication" />
          <StatCard label="Published" value={r.PUBLISHED ?? 0} icon={<CheckCircle2 className="size-6" />} />
        </div>
        <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader title="My classes & subjects" description={`${data!.assignments.length} assignment(s) this session`} />
            {!data!.assignments.length ? <EmptyState title="No classes assigned yet" description="An administrator will assign your classes and subjects." /> : (
              <ul className="divide-y divide-line">
                {data!.assignments.map((a: Rec) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                    <div><div className="font-semibold">{a.subject}</div><div className="text-sm text-muted">{a.class_name} · {a.arm_name}</div></div>
                    <Link className={btn("soft", "sm")} to={`/portal/results?class_id=${a.class_id}&arm_id=${a.arm_id ?? ""}&subject_id=${a.subject_id}`}>Enter results</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader title="Recent uploads" description={`${data!.material_count} material(s) in total`} action={<Link to="/portal/materials" className="text-sm font-semibold text-brand-700 hover:underline">Open</Link>} />
              {!data!.recent_materials.length ? <EmptyState title="No uploads yet" /> : (
                <ul className="divide-y divide-line">{data!.recent_materials.map((m: Rec) => <li key={m.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm"><span className="truncate font-medium">{m.title}</span><StatusBadge status={m.visibility} /></li>)}</ul>
              )}
            </Card>
            <Card className="p-5"><div className="flex items-center justify-between"><div><div className="font-semibold">Notifications</div><div className="text-sm text-muted">{data!.unread_notifications} unread</div></div><Link to="/portal/notifications" className={btn("outline", "sm")}>View</Link></div></Card>
          </div>
        </div>
        </>}
      </Async>
    </>
  );
}

function StudentDashboard() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => get<Rec>("/api/dashboard/student"), []);
  const photo = useAuthImage(data?.student.photo_url);
  const latest = data?.latest_result;
  async function download() {
    try { await saveFile(`/api/report-cards/${latest.card_id}/pdf`, "result.pdf"); } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <>
      <PageHeader title="My dashboard" description="Your results, learning materials and school announcements." />
      <Async loading={loading} error={error} onRetry={reload} rows={5}>
        {data && <>
        <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <Card className="p-6">
            <div className="flex items-center gap-4">
              <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-100 font-display text-2xl font-bold text-brand-800">{photo ? <img src={photo} alt="" className="size-full object-cover" /> : data!.student.first_name[0] + data!.student.last_name[0]}</div>
              <div className="min-w-0"><h2 className="truncate text-2xl font-semibold">{data!.student.full_name}</h2><div className="text-sm text-muted">{data!.student.student_no}</div><div className="mt-1 flex flex-wrap gap-1.5"><Badge tone="blue">{data!.class_name ?? "No class"}</Badge><Badge>{data!.current_session}</Badge></div></div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Link to="/portal/my-results" className={btn("primary")}><FileText className="size-4" /> Check Result</Link>
              <Link to="/portal/my-results" className={btn("outline")}><History className="size-4" /> Academic History</Link>
              <Link to="/portal/materials" className={btn("outline")}><Archive className="size-4" /> Learning Materials</Link>
              <button onClick={download} disabled={!latest} className={btn("outline", "md", "disabled:opacity-50")}><Download className="size-4" /> Download Result</button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Latest result" />
            {!latest ? <EmptyState title="No published result yet" description="Your result will appear here once it is published." /> : (
              <div className="flex flex-wrap items-center gap-6 p-6">
                <div><div className="text-sm text-muted">{latest.term}</div><div className="font-display text-5xl font-semibold text-brand-800">{latest.average}</div><div className="text-sm text-muted">average score</div></div>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm"><div className="text-muted">Overall grade</div><div className="font-bold">{latest.overall_grade}</div><div className="text-muted">Position</div><div className="font-bold">{latest.position ?? "—"}</div><div className="text-muted">Class</div><div className="font-bold">{latest.class_name}</div></div>
                <Link to={`/portal/my-results?card=${latest.card_id}`} className={btn("soft", "md", "ml-auto")}>View result</Link>
              </div>
            )}
          </Card>
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="My subjects" description="Open learning materials by subject" />
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
              {data!.subjects.map((s: Rec) => (
                <Link key={s.subject_id} to={`/portal/materials?subject_id=${s.subject_id}`} className="rounded-xl border border-line p-3.5 transition hover:border-brand-400 hover:bg-brand-50"><div className="font-semibold leading-tight">{s.subject}</div><div className="mt-1 text-xs text-muted">{s.count} material{s.count === 1 ? "" : "s"}</div></Link>
              ))}
            </div>
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader title="Academic history" />
              {!data!.history.length ? <EmptyState title="No previous results" /> : (
                <ul className="divide-y divide-line">{data!.history.flatMap((s: Rec) => s.terms.map((t: Rec) => <li key={t.card_id} className="flex items-center justify-between px-5 py-3 text-sm"><span><b>{s.session}</b> · {t.term}</span><Link className="font-semibold text-brand-700 hover:underline" to={`/portal/my-results?card=${t.card_id}`}>Avg {t.average}</Link></li>))}</ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Announcements" action={<Link to="/portal/announcements" className="text-sm font-semibold text-brand-700 hover:underline">All</Link>} />
              {!data!.announcements.length ? <EmptyState icon={<Megaphone className="size-7" />} title="No announcements" /> : (
                <ul className="divide-y divide-line">{data!.announcements.map((a: Rec) => <li key={a.id} className="px-5 py-3"><div className="font-semibold">{a.title}</div><div className="text-xs text-muted">{fmtDate(a.published_at)}</div></li>)}</ul>
              )}
            </Card>
          </div>
        </div>
        </>}
      </Async>
    </>
  );
}
