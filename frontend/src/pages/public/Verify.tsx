import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import { get, type Rec } from "@/lib/api";
import { useFetch } from "@/lib/hooks";
import { fmtDate } from "@/lib/utils";
import { btn, Card, ErrorState, Input, PageLoader } from "@/components/ui";

export default function Verify() {
  const { ref: param } = useParams();
  const [manual, setManual] = useState("");
  const ref = param ?? "";
  const { data, loading, error, reload } = useFetch(() => get<Rec>(`/api/verify/${encodeURIComponent(ref)}`), [ref], !!ref);

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:py-20">
      <h1 className="mb-6 text-center text-3xl font-semibold sm:text-4xl">Verify a result</h1>
      {!ref ? (
        <Card className="space-y-4 p-6">
          <p className="text-muted">Enter the reference number printed on the report card (for example VR-ABC123XYZ4), or scan its QR code.</p>
          <Input value={manual} onChange={(e) => setManual(e.target.value.toUpperCase())} placeholder="VR-XXXXXXXXXX" className="font-mono" />
          <Link to={`/verify/${manual.trim()}`} className={btn("primary", "md", "w-full")} aria-disabled={!manual.trim()}>Verify</Link>
        </Card>
      ) : loading ? <PageLoader rows={3} /> : error ? <ErrorState message={error} onRetry={reload} /> : data?.valid ? (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 bg-emerald-600 px-6 py-5 text-white"><BadgeCheck className="size-9" /><div><div className="text-xl font-bold">Genuine result</div><div className="text-sm text-white/85">Issued by {data.school}</div></div></div>
          <dl className="grid grid-cols-2 gap-5 p-6 text-sm">
            {[["Student", data.student], ["Class", data.class_name], ["Session", data.session], ["Term", data.term], ["Reference", data.reference], ["Issued", fmtDate(data.issued_at)]].map(([k, v]) => (
              <div key={k}><dt className="text-xs font-semibold uppercase tracking-wide text-muted">{k}</dt><dd className="mt-0.5 text-base font-semibold">{v}</dd></div>
            ))}
          </dl>
          <p className="border-t border-line px-6 py-4 text-xs text-muted">Only limited information is shown to protect the student's privacy. Scores are not displayed here.</p>
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-red-100 text-red-700"><ShieldAlert className="size-8" /></div>
          <h2 className="text-2xl font-semibold">Not verified</h2>
          <p className="mt-2 text-muted">We could not find a published result with this reference. Check the reference and try again, or contact the school.</p>
          <Link to="/verify" className={btn("outline", "md", "mt-6")}>Try another reference</Link>
        </Card>
      )}
    </div>
  );
}
