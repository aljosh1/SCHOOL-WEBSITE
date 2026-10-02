import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Archive, Bell, BookOpen, ClipboardCheck, ClipboardList, FileClock, FileText, GraduationCap, History, KeyRound, LayoutDashboard,
  LogOut, Megaphone, Menu, PieChart, ScrollText, Settings, ShieldCheck, Ticket, UserCog, UserPlus, Users, X, type LucideIcon,
} from "lucide-react";
import { useAuth, type Role } from "@/lib/auth";
import { get } from "@/lib/api";
import { useSchool } from "@/lib/school";
import { cn } from "@/lib/utils";
import { Logo } from "./Layouts";
import { PageLoader } from "./ui";

interface Item { to: string; label: string; icon: LucideIcon; perm?: string; roles?: Role[]; end?: boolean }
interface Group { title?: string; items: Item[] }

const ADMINS: Role[] = ["SUPER_ADMIN", "ADMIN"];
const NAV: Group[] = [
  { items: [{ to: "/portal", label: "Dashboard", icon: LayoutDashboard, end: true }] },
  {
    title: "People",
    items: [
      { to: "/portal/students", label: "Students", icon: GraduationCap, perm: "students.read", roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"] },
      { to: "/portal/teachers", label: "Teachers", icon: Users, perm: "teachers.write" },
      { to: "/portal/users", label: "User accounts", icon: UserCog, perm: "users.manage" },
    ],
  },
  {
    title: "Academics",
    items: [
      { to: "/portal/academics", label: "Sessions & classes", icon: BookOpen, perm: "academics.write" },
      { to: "/portal/results", label: "Result entry", icon: ClipboardList, perm: "results.write", roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"] },
      { to: "/portal/approvals", label: "Approvals", icon: ClipboardCheck, perm: "results.approve", roles: ADMINS },
      { to: "/portal/amendments", label: "Amendments", icon: FileClock, perm: "results.amend", roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"] },
      { to: "/portal/reports", label: "Reports", icon: PieChart, perm: "reports.read", roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"] },
      { to: "/portal/codes", label: "Result codes", icon: Ticket, perm: "codes.manage" },
    ],
  },
  {
    title: "Learning",
    items: [
      { to: "/portal/my-results", label: "My results", icon: FileText, roles: ["STUDENT"] },
      { to: "/portal/materials", label: "Learning materials", icon: Archive, perm: "materials.read" },
      { to: "/portal/announcements", label: "Announcements", icon: Megaphone },
      { to: "/portal/admissions", label: "Admissions", icon: UserPlus, perm: "admissions.manage" },
    ],
  },
  {
    title: "System",
    items: [
      { to: "/portal/profile", label: "My account", icon: UserCog, roles: ["STUDENT"] },
      { to: "/portal/audit", label: "Audit log", icon: ScrollText, perm: "audit.read" },
      { to: "/portal/permissions", label: "Permissions", icon: ShieldCheck, perm: "permissions.manage" },
      { to: "/portal/backups", label: "Backups", icon: History, perm: "backups.manage" },
      { to: "/portal/settings", label: "School settings", icon: Settings, perm: "settings.manage" },
    ],
  },
];

export function PortalLayout() {
  const { user, loading, logout, can } = useAuth();
  const { school } = useSchool();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = () => get<{ unread: number }>("/api/notifications", { page_size: 1 }).then((r) => alive && setUnread(r.unread)).catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [user]);

  if (loading) return <div className="grid min-h-dvh place-items-center p-8"><div className="w-full max-w-md"><PageLoader rows={4} /></div></div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (user.must_change_password && loc.pathname !== "/portal/account") return <Navigate to="/portal/account" replace />;

  const visible = (i: Item) => (!i.roles || i.roles.includes(user.role)) && (!i.perm || can(i.perm));
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter(visible) })).filter((g) => g.items.length);

  const sidebar = (
    <div className="flex h-full flex-col bg-brand-900 text-white">
      <Link to="/" className="block border-b border-white/10 px-5 py-5"><Logo light /></Link>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Portal">
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.title && <div className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-widest text-white/45">{g.title}</div>}
            {g.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition", isActive ? "bg-white text-brand-900" : "text-white/80 hover:bg-white/10 hover:text-white")}>
                <i.icon className="size-[18px] shrink-0" />{i.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <button onClick={() => { logout(); nav("/login"); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/80 hover:bg-white/10">
          <LogOut className="size-[18px]" /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[272px_1fr]">
      <aside className="no-print sticky top-0 hidden h-dvh lg:block">{sidebar}</aside>
      {open && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 shadow-2xl">{sidebar}</div>
        </div>
      )}
      <div className="min-w-0">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 lg:hidden" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>{open ? <X className="size-6" /> : <Menu className="size-6" />}</button>
          <div className="hidden text-sm text-muted lg:block">{school?.current_session ? <>Session <b className="text-ink">{school.current_session.name}</b>{school.current_term && <> · {school.current_term.name}</>}</> : null}</div>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/portal/notifications" className="relative rounded-lg p-2 hover:bg-stone-100" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
              <Bell className="size-5" />
              {unread > 0 && <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-accent-600 px-1 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <Link to={user.role === "STUDENT" ? "/portal/profile" : "/portal/account"} className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-3 hover:bg-stone-100">
              <span className="grid size-9 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">{user.full_name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span>
              <span className="hidden text-left leading-tight sm:block"><span className="block text-sm font-semibold">{user.full_name}</span><span className="block text-xs capitalize text-muted">{user.role.replace("_", " ").toLowerCase()}</span></span>
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8"><Outlet /></main>
      </div>
    </div>
  );
}

export function RequirePerm({ perm, roles, children }: { perm?: string; roles?: Role[]; children: React.ReactNode }) {
  const { user, can } = useAuth();
  if (!user) return null;
  if ((perm && !can(perm)) || (roles && !roles.includes(user.role))) return <Navigate to="/portal" replace />;
  return <>{children}</>;
}

export { KeyRound };
