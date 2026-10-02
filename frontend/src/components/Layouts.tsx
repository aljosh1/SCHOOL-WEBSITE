import { useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { MapPin, Menu, Phone, Mail, X, GraduationCap } from "lucide-react";
import { useSchool } from "@/lib/school";
import { cn } from "@/lib/utils";
import { btn } from "./ui";

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  const { school, logo } = useSchool();
  return (
    <span className={cn("flex items-center gap-3", className)}>
      {logo ? (
        <img src={logo} alt="" className="size-11 rounded-full bg-white object-contain" />
      ) : (
        <span className="grid size-11 place-items-center rounded-full bg-brand-700 text-white"><GraduationCap className="size-6" /></span>
      )}
      <span className="leading-tight">
        <span className={cn("block font-display text-[17px] font-semibold", light ? "text-white" : "text-brand-900")}>{school?.name ?? "School"}</span>
        {school?.motto && <span className={cn("hidden text-xs sm:block", light ? "text-white/70" : "text-muted")}>{school.motto}</span>}
      </span>
    </span>
  );
}

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/about", label: "About" },
  { to: "/admissions", label: "Admissions" },
  { to: "/news", label: "News & Events" },
  { to: "/contact", label: "Contact" },
];

const Social = ({ href, label, d }: { href?: string | null; label: string; d: string }) =>
  href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className="grid size-9 place-items-center rounded-full bg-white/10 transition hover:bg-white/20">
      <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden><path d={d} /></svg>
    </a>
  ) : null;

export function PublicLayout({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { school } = useSchool();
  useLocation();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="no-print sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" aria-label="Home"><Logo /></Link>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => cn("rounded-lg px-3 py-2 text-sm font-semibold transition hover:bg-brand-50", isActive ? "text-brand-700" : "text-ink/80")}>{l.label}</NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            <Link to="/check-result" className={btn("accent", "sm")}>Check Result</Link>
            <Link to="/login" className={btn("primary", "sm")}>Student Portal</Link>
          </div>
          <button className="rounded-lg p-2 lg:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>
        {open && (
          <div className="border-t border-line bg-white px-4 pb-5 lg:hidden">
            <nav className="flex flex-col py-2" aria-label="Mobile">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} onClick={() => setOpen(false)} className={({ isActive }) => cn("rounded-lg px-3 py-3 font-semibold", isActive ? "bg-brand-50 text-brand-700" : "")}>{l.label}</NavLink>
              ))}
            </nav>
            <div className="grid grid-cols-2 gap-2">
              <Link onClick={() => setOpen(false)} to="/check-result" className={btn("accent")}>Check Result</Link>
              <Link onClick={() => setOpen(false)} to="/login" className={btn("primary")}>Student Portal</Link>
            </div>
          </div>
        )}
      </header>
      <main className="flex-1">{children ?? <Outlet />}</main>
      <footer className="no-print bg-brand-900 text-white/85">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo light />
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/70">{school?.mission ?? school?.motto}</p>
            <div className="mt-5 flex gap-2">
              <Social href={school?.facebook} label="Facebook" d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z" />
              <Social href={school?.instagram} label="Instagram" d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm5 3.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 0 1 12 7.5zm0 2A2.5 2.5 0 1 0 14.5 12 2.5 2.5 0 0 0 12 9.5zM17.2 5.8a1 1 0 1 1-1 1 1 1 0 0 1 1-1z" />
              <Social href={school?.twitter} label="X (Twitter)" d="M18.2 2h3.1l-6.8 7.7L22.5 22h-6.3l-4.9-6.4L5.6 22H2.5l7.3-8.3L1.9 2h6.4l4.4 5.9L18.2 2zm-1.1 18h1.7L7.3 3.9H5.5L17.1 20z" />
              <Social href={school?.youtube} label="YouTube" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z" />
            </div>
          </div>
          <div>
            <h4 className="mb-3 font-display text-lg text-white">Quick links</h4>
            <ul className="space-y-2 text-sm">
              {[...links, { to: "/check-result", label: "Check Result" }, { to: "/login", label: "Student Portal" }].map((l) => (
                <li key={l.to}><Link to={l.to} className="hover:text-white hover:underline">{l.label}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-3 font-display text-lg text-white">Contact</h4>
            <ul className="space-y-3 text-sm">
              {school?.address && <li className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0" />{school.address}</li>}
              {school?.phone && <li className="flex gap-2"><Phone className="mt-0.5 size-4 shrink-0" /><a href={`tel:${school.phone.replace(/\s/g, "")}`}>{school.phone}</a></li>}
              {school?.email && <li className="flex gap-2"><Mail className="mt-0.5 size-4 shrink-0" /><a href={`mailto:${school.email}`}>{school.email}</a></li>}
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 py-5 text-center text-xs text-white/60">© {new Date().getFullYear()} {school?.name}. All rights reserved.</div>
      </footer>
    </div>
  );
}
