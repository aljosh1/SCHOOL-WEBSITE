import { apiUrl } from "@/lib/api";
import { useAuthImage } from "@/lib/hooks";
import { cn, fmtDate, fmtNum, gradeColor } from "@/lib/utils";
import { GraduationCap } from "lucide-react";
import type { Rec } from "@/lib/api";

interface Props { report: Rec; school: Rec; photoSrc?: string | null; protectedPhoto?: string | null; className?: string }

/** On-screen report card; also the print layout (see .print-area in index.css). */
export function ResultSheet({ report, school, photoSrc, protectedPhoto, className }: Props) {
  const authPhoto = useAuthImage(protectedPhoto);
  const photo = photoSrc ?? authPhoto;
  const s = report.summary;
  const st = report.student;
  const showPos = report.subjects.some((x: Rec) => x.position_label);
  const logo = school.logo_url ? apiUrl(school.logo_url) : null;

  return (
    <article className={cn("print-area mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-white shadow-sm", className)} aria-label="Report card">
      <div className="h-2 bg-gradient-to-r from-brand-700 via-brand-500 to-accent-500" />
      <div className="p-4 sm:p-8">
        <header className="flex items-center gap-4 border-b-2 border-brand-700 pb-5">
          <div className="grid size-16 shrink-0 place-items-center sm:size-20">
            {logo ? <img src={logo} alt="School logo" className="max-h-full max-w-full object-contain" /> : <GraduationCap className="size-12 text-brand-700" />}
          </div>
          <div className="min-w-0 flex-1 text-center">
            <h2 className="font-display text-xl font-bold uppercase leading-tight text-brand-900 sm:text-2xl">{school.name}</h2>
            {school.motto && <p className="text-xs italic text-muted sm:text-sm">{school.motto}</p>}
            <p className="mt-1 text-xs text-muted">{[school.address, school.phone, school.email].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="grid h-24 w-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-stone-50 sm:h-28 sm:w-24">
            {photo ? <img src={photo} alt={`${st.name}'s photograph`} className="size-full object-cover" /> : <span className="px-1 text-center text-[10px] text-muted">No photograph</span>}
          </div>
        </header>

        <div className="my-5 rounded-lg bg-brand-700 py-2 text-center text-sm font-bold uppercase tracking-wider text-white sm:text-base">
          Student report card — {report.term} · {report.session} session
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-line bg-brand-50/50 p-4 text-sm sm:grid-cols-4">
          {[
            ["Name", st.name], ["Student ID", st.student_no], ["Class", report.class_name], ["Admission No.", st.admission_no],
            ["Session", report.session], ["Term", report.term], ["Class size", s.class_size], ["Next term begins", fmtDate(report.next_term_begins)],
          ].map(([k, v]) => (
            <div key={String(k)} className={k === "Name" ? "col-span-2" : ""}><dt className="text-xs font-semibold uppercase tracking-wide text-muted">{k}</dt><dd className="font-semibold">{v ?? "—"}</dd></div>
          ))}
        </dl>

        <div className="mt-5 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead className="bg-brand-700 text-white">
              <tr className="text-xs uppercase tracking-wider">
                <th className="px-3 py-2.5 text-left">Subject</th>
                <th className="px-2 py-2.5 text-center">CA<span className="block font-normal opacity-80">/{fmtNum(report.ca_max)}</span></th>
                <th className="px-2 py-2.5 text-center">Exam<span className="block font-normal opacity-80">/{fmtNum(report.exam_max)}</span></th>
                <th className="px-2 py-2.5 text-center">Total<span className="block font-normal opacity-80">/{fmtNum(report.total_max)}</span></th>
                <th className="px-2 py-2.5 text-center">Grade</th>
                {showPos && <th className="px-2 py-2.5 text-center">Pos.</th>}
                <th className="px-3 py-2.5 text-left">Remark</th>
              </tr>
            </thead>
            <tbody>
              {report.subjects.map((x: Rec) => (
                <tr key={x.subject_code} className="border-t border-line even:bg-stone-50/60">
                  <td className="px-3 py-2.5 font-semibold">{x.subject}</td>
                  <td className="px-2 py-2.5 text-center tabular-nums">{fmtNum(x.ca_score)}</td>
                  <td className="px-2 py-2.5 text-center tabular-nums">{fmtNum(x.exam_score)}</td>
                  <td className="px-2 py-2.5 text-center font-bold tabular-nums">{fmtNum(x.total)}</td>
                  <td className="px-2 py-2.5 text-center"><span className={cn("inline-block min-w-7 rounded px-1.5 py-0.5 text-xs font-bold", gradeColor(x.grade))}>{x.grade ?? "—"}</span></td>
                  {showPos && <td className="px-2 py-2.5 text-center tabular-nums">{x.position_label ?? "—"}</td>}
                  <td className="px-3 py-2.5 text-muted">{x.grade_description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Subjects", s.subjects_count], ["Total score", fmtNum(s.total_score)], ["Average", fmtNum(s.average)],
            ["Overall grade", s.overall_grade ? `${s.overall_grade} — ${s.overall_description}` : "—"],
            ["Position", s.position_label ? `${s.position_label} of ${s.class_size}` : "—"], ["Class average", fmtNum(s.class_average)],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-xl border border-line bg-white p-3 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</div>
              <div className="mt-0.5 font-display text-lg font-bold text-brand-800">{v}</div>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          Grading: {report.grading.map((g: Rec) => `${g.grade} ${g.min}–${g.max} (${g.description})`).join(" · ")}
        </p>

        <div className="mt-5 space-y-3 text-sm">
          <div className="rounded-xl border border-line p-4"><div className="text-xs font-bold uppercase tracking-wide text-brand-700">Class teacher's remark</div><p className="mt-1">{report.teacher_remark || "—"}</p></div>
          <div className="rounded-xl border border-line p-4"><div className="text-xs font-bold uppercase tracking-wide text-brand-700">{school.principal_title ?? "Principal"}'s remark</div><p className="mt-1">{report.principal_remark || "—"}</p></div>
        </div>

        <footer className="mt-6 flex flex-wrap items-end justify-between gap-5 border-t border-line pt-5">
          <div className="min-w-44">
            <div className="h-10 border-b border-ink/40" />
            <div className="mt-1 text-sm font-semibold">{school.principal_name ?? ""}</div>
            <div className="text-xs text-muted">{school.principal_title ?? "Principal"} · Signature &amp; stamp</div>
          </div>
          <div className="text-xs text-muted">
            <div>Date issued: <b className="text-ink">{fmtDate(report.published_at)}</b></div>
            <div>Reference: <b className="font-mono text-ink">{report.verification_ref}</b></div>
            <div className="mt-1 max-w-56">Scan the QR code to confirm this result is genuine.</div>
          </div>
          {report.verification_ref && <img src={apiUrl(`/api/verify/${report.verification_ref}/qr`)} alt="Verification QR code" className="size-24" width={96} height={96} />}
        </footer>
      </div>
    </article>
  );
}
