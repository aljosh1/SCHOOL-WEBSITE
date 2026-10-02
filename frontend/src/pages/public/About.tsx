import { Link } from "react-router-dom";
import { Eye, Target, Quote } from "lucide-react";
import { get, type Rec } from "@/lib/api";
import { useFetch } from "@/lib/hooks";
import { useSchool } from "@/lib/school";
import { achievements, facilities } from "@/content";
import { btn, Card, EmptyState, Skeleton } from "@/components/ui";
import { SectionTitle } from "./Home";

export function PageBanner({ title, text }: { title: string; text?: string }) {
  return (
    <div className="bg-brand-900 text-white">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <h1 className="text-4xl font-semibold sm:text-5xl">{title}</h1>
        {text && <p className="mt-3 max-w-2xl text-lg text-white/75">{text}</p>}
      </div>
    </div>
  );
}

export default function About() {
  const { school } = useSchool();
  const staff = useFetch(() => get<Rec[]>("/api/public/staff"), []);
  if (!school) return <div className="mx-auto max-w-4xl p-10"><Skeleton className="h-64" /></div>;
  return (
    <>
      <PageBanner title={`About ${school.short_name || "us"}`} text={school.motto ?? undefined} />
      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <SectionTitle kicker="Our story" title="School history" />
        <p className="text-lg leading-relaxed text-muted">{school.history ?? "Our history will be published soon."}</p>
      </section>

      <section className="bg-brand-50/70 py-16">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 md:grid-cols-2">
          <Card className="p-8"><Eye className="size-8 text-accent-600" /><h2 className="mt-3 text-2xl font-semibold">Our vision</h2><p className="mt-2 leading-relaxed text-muted">{school.vision ?? "—"}</p></Card>
          <Card className="p-8"><Target className="size-8 text-accent-600" /><h2 className="mt-3 text-2xl font-semibold">Our mission</h2><p className="mt-2 leading-relaxed text-muted">{school.mission ?? "—"}</p></Card>
        </div>
      </section>

      {school.core_values?.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <SectionTitle kicker="What we stand for" title="Core values" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {school.core_values.map((v: string) => <div key={v} className="rounded-2xl border border-line bg-white p-5 text-center font-display text-lg font-semibold text-brand-800">{v}</div>)}
          </div>
        </section>
      )}

      <section className="bg-brand-900 py-16 text-white">
        <div className="mx-auto grid max-w-5xl items-center gap-8 px-4 sm:px-6 md:grid-cols-[auto_1fr]">
          <div className="grid size-32 place-items-center rounded-full bg-white/10 ring-4 ring-accent-500/50 font-display text-5xl text-accent-300">{(school.principal_name ?? "P").replace(/^(Dr\.?|Mrs?\.?|Prof\.?|\(Mrs\.\))\s*/i, "")[0]}</div>
          <div>
            <Quote className="size-8 text-accent-300" />
            <h2 className="mt-2 text-3xl font-semibold">Principal's message</h2>
            <p className="mt-3 text-lg leading-relaxed text-white/85">{school.principal_message ?? "—"}</p>
            <div className="mt-4 font-display text-xl text-accent-300">{school.principal_name}</div>
            <div className="text-sm text-white/70">{school.principal_title}</div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <SectionTitle kicker="How we teach" title="Academic philosophy" />
        <p className="text-lg leading-relaxed text-muted">{school.philosophy ?? "—"}</p>
      </section>

      <section className="bg-brand-50/70 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionTitle kicker="Our people" title="School leadership & teaching staff" />
          <div className="mb-6 flex items-center gap-4 rounded-2xl border border-line bg-white p-5">
            <div className="grid size-14 place-items-center rounded-full bg-brand-700 font-display text-xl text-white">{(school.principal_name ?? "P").replace(/^(Dr\.?|Mrs?\.?|Prof\.?|\(Mrs\.\))\s*/i, "")[0]}</div>
            <div><div className="font-semibold">{school.principal_name}</div><div className="text-sm text-muted">{school.principal_title}</div></div>
          </div>
          {staff.loading ? <Skeleton className="h-32" /> : !staff.data?.length ? <Card><EmptyState title="Staff list coming soon" /></Card> : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {staff.data.map((t) => (
                <Card key={t.name} className="flex items-center gap-4 p-4"><div className="grid size-12 shrink-0 place-items-center rounded-full bg-accent-50 font-bold text-accent-700">{t.name.replace(/^(Mrs?\.?|Dr\.?|Prof\.?|Miss)\s*/i, "")[0]}</div>
                  <div className="min-w-0"><div className="truncate font-semibold">{t.name}</div><div className="truncate text-sm text-muted">{t.title}</div>{t.qualification && <div className="truncate text-xs text-muted/80">{t.qualification}</div>}</div></Card>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-5 text-3xl font-semibold text-brand-900">Facilities</h2>
          <ul className="space-y-3">{facilities.map((f) => <li key={f.title} className="rounded-xl border border-line bg-white p-4"><b>{f.title}</b><span className="text-muted"> — {f.text}</span></li>)}</ul>
        </div>
        <div>
          <h2 className="mb-5 text-3xl font-semibold text-brand-900">Achievements</h2>
          <ul className="space-y-3">{achievements.map((f) => <li key={f.title} className="rounded-xl border border-line bg-white p-4"><b>{f.title}</b><span className="text-muted"> — {f.text}</span></li>)}</ul>
          <Link to="/admissions#apply" className={btn("accent", "lg", "mt-8")}>Apply for admission</Link>
        </div>
      </section>
    </>
  );
}
