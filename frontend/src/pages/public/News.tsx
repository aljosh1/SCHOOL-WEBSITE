import { useState } from "react";
import { Calendar } from "lucide-react";
import { get, apiUrl, type Paged } from "@/lib/api";
import { useFetch } from "@/lib/hooks";
import { cn, fmtDate } from "@/lib/utils";
import { Async, Badge, Card, EmptyState, Pagination } from "@/components/ui";
import { PageBanner } from "./About";
import { ContactSection } from "./Home";

const CATS = [["", "All"], ["NEWS", "News"], ["EVENT", "Events"], ["EXAM", "Exams"], ["HOLIDAY", "Holidays"], ["ADMISSION", "Admissions"], ["PARENT_NOTICE", "Parents"], ["ACADEMIC", "Academic"]];

export default function News() {
  const [cat, setCat] = useState("");
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch(() => get<Paged>("/api/public/announcements", { category: cat, page, page_size: 8 }), [cat, page]);
  return (
    <>
      <PageBanner title="News & Events" text="Announcements, exam dates, holidays and school events." />
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <div className="mb-6 flex flex-wrap gap-2">
          {CATS.map(([v, l]) => <button key={v} onClick={() => { setCat(v); setPage(1); }} className={cn("rounded-full px-4 py-1.5 text-sm font-semibold ring-1 transition", cat === v ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-ink ring-line hover:ring-brand-400")}>{l}</button>)}
        </div>
        <Card>
          <Async loading={loading} error={error} onRetry={reload} empty={!data?.items.length} emptyNode={<EmptyState title="No announcements" description="Nothing has been published in this category yet." />}>
            <div className="divide-y divide-line">
              {data?.items.map((a) => (
                <article key={a.id} className="flex flex-col gap-4 p-5 sm:flex-row">
                  {a.image_url && <img src={apiUrl(a.image_url)} alt="" loading="lazy" className="h-40 w-full rounded-xl object-cover sm:h-28 sm:w-44" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><Badge tone="amber">{a.category.replace("_", " ")}</Badge><span className="text-xs text-muted">{fmtDate(a.published_at)}</span></div>
                    <h2 className="mt-1.5 text-xl font-semibold">{a.title}</h2>
                    {a.event_date && <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-brand-700"><Calendar className="size-4" />{fmtDate(a.event_date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>}
                    <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-muted">{a.body}</p>
                  </div>
                </article>
              ))}
            </div>
            <Pagination page={page} pageSize={8} total={data?.total ?? 0} onChange={setPage} />
          </Async>
        </Card>
      </section>
    </>
  );
}

export function Contact() {
  return (
    <>
      <PageBanner title="Contact us" text="We would love to hear from you." />
      <ContactSection heading={false} />
    </>
  );
}
