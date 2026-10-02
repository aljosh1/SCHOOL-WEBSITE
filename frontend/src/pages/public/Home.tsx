import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen, Building2, Calendar, Cpu, FileSearch, GraduationCap, Heart, LogIn, MapPin, Phone, Mail, ShieldCheck, Sparkles, Users } from "lucide-react";
import { apiUrl, get, type Paged, type Rec } from "@/lib/api";
import { useFetch } from "@/lib/hooks";
import { useSchool } from "@/lib/school";
import { fmtDate } from "@/lib/utils";
import { achievements, facilities, pillars, testimonials } from "@/content";
import { btn, Card, EmptyState, Skeleton } from "@/components/ui";

const icons = { GraduationCap, Cpu, Users, Building2, Heart, ShieldCheck } as const;

const Reveal = ({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) => (
  <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.45, delay }} className={className}>{children}</motion.div>
);

export const SectionTitle = ({ kicker, title, text }: { kicker?: string; title: string; text?: string }) => (
  <div className="mx-auto mb-10 max-w-2xl text-center">
    {kicker && <div className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-accent-600">{kicker}</div>}
    <h2 className="text-3xl font-semibold text-brand-900 sm:text-4xl">{title}</h2>
    {text && <p className="mt-3 text-[17px] text-muted">{text}</p>}
  </div>
);

export default function Home() {
  const { school } = useSchool();
  const stats = useFetch(() => get<Rec>("/api/public/stats"), []);
  const classes = useFetch(() => get<Rec[]>("/api/public/classes"), []);
  const news = useFetch(() => get<Paged>("/api/public/announcements", { page_size: 20 }), []);

  const today = new Date(new Date().toDateString());
  const items = news.data?.items ?? [];
  const events = items.filter((a) => a.event_date && new Date(a.event_date) >= today).sort((a, b) => +new Date(a.event_date) - +new Date(b.event_date)).slice(0, 4);
  const latest = items.slice(0, 3);
  const junior = (classes.data ?? []).filter((c) => /^jss|junior/i.test(c.name));
  const senior = (classes.data ?? []).filter((c) => /^ss|senior/i.test(c.name));
  const otherClasses = (classes.data ?? []).filter((c) => !junior.includes(c) && !senior.includes(c));

  return (
    <>
      {/* hero */}
      <section className="relative isolate overflow-hidden bg-brand-900 text-white">
        {school?.hero_url && <img src={apiUrl(school.hero_url)} alt="" className="absolute inset-0 -z-20 size-full object-cover opacity-30" fetchPriority="high" />}
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_85%_20%,var(--color-brand-600)_0%,transparent_60%),radial-gradient(40%_60%_at_10%_90%,var(--color-accent-700)_0%,transparent_65%)] opacity-70" />
        <svg className="absolute -right-24 -top-24 -z-10 size-[520px] opacity-[.07]" viewBox="0 0 200 200" aria-hidden><circle cx="100" cy="100" r="98" fill="none" stroke="#fff" strokeWidth="2" /><circle cx="100" cy="100" r="70" fill="none" stroke="#fff" strokeWidth="2" /><circle cx="100" cy="100" r="42" fill="none" stroke="#fff" strokeWidth="2" /></svg>
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.15fr_.85fr] lg:py-24">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-sm font-medium ring-1 ring-white/20"><Sparkles className="size-4 text-accent-300" /> {school?.current_session ? `Admissions open · ${school.current_session.name} session` : "Welcome"}</span>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.05] sm:text-5xl lg:text-6xl">Building Tomorrow's <span className="text-accent-300">Leaders</span></h1>
            <p className="mt-5 max-w-xl text-lg text-white/80">{school?.name ? `${school.name} is an organised, safe and technology-driven school where academic excellence meets strong values.` : "A safe, modern, academically focused school."} {school?.motto && <em className="block mt-2 text-white/70">“{school.motto}”</em>}</p>
            <div className="mt-8 grid max-w-xl grid-cols-2 gap-3 sm:flex sm:flex-wrap">
              <Link to="/admissions#apply" className={btn("accent", "lg")}>Apply Now <ArrowRight className="size-4" /></Link>
              <Link to="/check-result" className={btn("outline", "lg", "border-white/30 bg-white/10 text-white hover:bg-white/20 hover:border-white/50")}><FileSearch className="size-4" /> Check Result</Link>
              <Link to="/login" className={btn("outline", "lg", "border-white/30 bg-white/10 text-white hover:bg-white/20 hover:border-white/50")}><LogIn className="size-4" /> Student Portal</Link>
              <Link to="/login?next=/portal/materials" className={btn("outline", "lg", "border-white/30 bg-white/10 text-white hover:bg-white/20 hover:border-white/50")}><BookOpen className="size-4" /> Learning Materials</Link>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, delay: 0.1 }} className="grid grid-cols-2 gap-3">
            {[
              ["Students", stats.data?.students, GraduationCap], ["Teachers", stats.data?.teachers, Users],
              ["Classes", stats.data?.classes, Building2], ["Subjects", stats.data?.subjects, BookOpen],
            ].map(([label, value, Icon]: any) => (
              <div key={label} className="rounded-2xl bg-white/10 p-5 ring-1 ring-white/15 backdrop-blur">
                <Icon className="size-6 text-accent-300" />
                <div className="mt-3 font-display text-4xl font-semibold tabular-nums">{stats.loading ? <Skeleton className="h-9 w-16 bg-white/10" /> : value ?? "—"}</div>
                <div className="text-sm text-white/70">{label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* pillars */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionTitle kicker="Why choose us" title="A school parents can trust" text="Organised, modern, safe and academically focused — from admission to graduation." />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map((p, i) => {
            const Icon = icons[p.icon];
            return (
              <Reveal key={p.title} delay={i * 0.05}>
                <Card className="h-full p-6 transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="mb-4 grid size-12 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon className="size-6" /></div>
                  <h3 className="text-xl font-semibold">{p.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">{p.text}</p>
                </Card>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* academic excellence */}
      <section className="bg-brand-50/70">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <Reveal>
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-accent-600">Academic excellence</div>
            <h2 className="text-3xl font-semibold text-brand-900 sm:text-4xl">Results you can see, term after term</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">{school?.philosophy ?? "Learning is most effective when it is student-centred, practical and rooted in strong values."}</p>
            <ul className="mt-6 space-y-3">
              {["Continuous assessment and termly examinations", "Online result checking with secure access cards", "Printable, verifiable report cards with QR codes", "Learning materials available to students online"].map((t) => (
                <li key={t} className="flex gap-3"><span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-brand-700 text-xs text-white">✓</span>{t}</li>
              ))}
            </ul>
            <Link to="/about" className={btn("primary", "md", "mt-8")}>About our school <ArrowRight className="size-4" /></Link>
          </Reveal>
          <Reveal delay={0.1} className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            {achievements.map((a) => (
              <Card key={a.title} className="p-5"><h3 className="font-display text-lg font-semibold text-brand-800">{a.title}</h3><p className="mt-1 text-sm text-muted">{a.text}</p></Card>
            ))}
          </Reveal>
        </div>
      </section>

      {/* facilities */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionTitle kicker="Facilities" title="A modern learning environment" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {facilities.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.04}>
              <div className="flex gap-4 rounded-2xl border border-line bg-white p-5">
                <div className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-50 font-display text-lg font-bold text-accent-700">{i + 1}</div>
                <div><h3 className="font-semibold">{f.title}</h3><p className="mt-1 text-sm text-muted">{f.text}</p></div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* programmes */}
      <section className="bg-brand-900 py-20 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionTitle kicker="Programmes" title="Classes we offer" text="From junior secondary through senior secondary, with a clear path to WAEC and NECO." />
          {classes.loading ? <Skeleton className="mx-auto h-24 max-w-3xl bg-white/10" /> : !classes.data?.length ? <EmptyState title="Classes will be listed soon" /> : (
            <div className="grid gap-6 md:grid-cols-2">
              {[["Junior Secondary", junior, "Foundation subjects, ICT, civic values and the Basic Education Certificate Examination."], ["Senior Secondary", senior, "Science, Arts and Commercial preparation for WAEC, NECO and university admission."], ...(otherClasses.length ? [["Other classes", otherClasses, ""]] : [])].map(([title, list, text]: any) => list.length > 0 && (
                <div key={title} className="rounded-2xl bg-white/10 p-6 ring-1 ring-white/15">
                  <h3 className="text-2xl font-semibold text-accent-300">{title}</h3>
                  {text && <p className="mt-1 text-sm text-white/75">{text}</p>}
                  <div className="mt-4 flex flex-wrap gap-2">{list.map((c: Rec) => <span key={c.id} className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-brand-900">{c.name}</span>)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* testimonials */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionTitle kicker="Testimonials" title="What families say" />
        <div className="grid gap-5 md:grid-cols-3">
          {testimonials.map((t) => (
            <Card key={t.quote} className="p-6"><p className="font-display text-lg leading-relaxed text-brand-900">“{t.quote}”</p><div className="mt-4 text-sm font-semibold">{t.name} <span className="font-normal text-muted">· {t.role}</span></div></Card>
          ))}
        </div>
      </section>

      {/* news + events */}
      <section className="bg-brand-50/70 py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="mb-5 flex items-end justify-between"><h2 className="text-3xl font-semibold text-brand-900">News &amp; announcements</h2><Link to="/news" className="text-sm font-semibold text-brand-700 hover:underline">View all</Link></div>
            {news.loading ? <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div> : news.error ? <p className="text-sm text-red-700">{news.error}</p> : !latest.length ? <Card><EmptyState title="No announcements yet" description="Check back soon for school news." /></Card> : (
              <div className="space-y-4">
                {latest.map((a) => (
                  <Card key={a.id} className="p-5">
                    <div className="text-xs font-semibold uppercase tracking-wide text-accent-700">{a.category.replace("_", " ")} · {fmtDate(a.published_at)}</div>
                    <h3 className="mt-1 text-xl font-semibold">{a.title}</h3>
                    <p className="mt-1 text-sm text-muted">{a.body.length > 180 ? a.body.slice(0, 180) + "…" : a.body}</p>
                  </Card>
                ))}
              </div>
            )}
          </div>
          <div>
            <h2 className="mb-5 text-3xl font-semibold text-brand-900">Upcoming events</h2>
            <Card className="divide-y divide-line">
              {news.loading ? <div className="p-5"><Skeleton className="h-16" /></div> : !events.length ? <EmptyState icon={<Calendar className="size-7" />} title="No upcoming events" /> : events.map((e) => (
                <div key={e.id} className="flex gap-4 p-4">
                  <div className="grid size-14 shrink-0 place-items-center rounded-xl bg-brand-700 text-center text-white"><div><div className="text-lg font-bold leading-none">{new Date(e.event_date).getDate()}</div><div className="text-[10px] uppercase">{new Date(e.event_date).toLocaleString("en", { month: "short" })}</div></div></div>
                  <div><div className="font-semibold">{e.title}</div><div className="text-xs text-muted">{fmtDate(e.event_date, { weekday: "long", day: "numeric", month: "long" })}</div></div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      </section>

      <ContactSection />
    </>
  );
}

export function ContactSection({ heading = true }: { heading?: boolean }) {
  const { school } = useSchool();
  if (!school) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6" id="contact">
      {heading && <SectionTitle kicker="Contact" title="Visit or get in touch" text="We would be glad to welcome you to the school." />}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-5 p-6">
          {[
            [MapPin, "Address", school.address], [Phone, "Phone", school.phone, school.phone ? `tel:${school.phone.replace(/\s/g, "")}` : null], [Mail, "Email", school.email, school.email ? `mailto:${school.email}` : null],
          ].map(([Icon, label, value, href]: any) => value && (
            <div key={label} className="flex gap-4"><div className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon className="size-5" /></div>
              <div><div className="text-xs font-bold uppercase tracking-wide text-muted">{label}</div>{href ? <a href={href} className="font-semibold hover:underline">{value}</a> : <div className="font-semibold">{value}</div>}</div></div>
          ))}
          <div className="flex flex-wrap gap-3 pt-2 text-sm font-semibold">
            {[["Facebook", school.facebook], ["Instagram", school.instagram], ["X / Twitter", school.twitter], ["YouTube", school.youtube]].map(([n, u]) => u && <a key={n} href={u} target="_blank" rel="noopener noreferrer" className="rounded-full bg-brand-50 px-4 py-2 text-brand-800 hover:bg-brand-100">{n}</a>)}
          </div>
        </Card>
        <div className="min-h-72 overflow-hidden rounded-2xl border border-line bg-stone-100">
          {school.map_embed_url ? <iframe title="School location on Google Maps" src={school.map_embed_url} className="size-full min-h-72 border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen /> : <EmptyState icon={<MapPin className="size-7" />} title="Map not set" description="The school map will appear here." />}
        </div>
      </div>
    </section>
  );
}
