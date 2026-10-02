import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Download, KeyRound, Plus, Power, RotateCcw, Trash2, DatabaseBackup } from "lucide-react";
import { del, get, post, put, saveFile, type Paged, type Rec } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced, useFetch, useToast } from "@/lib/hooks";
import { fmtBytes, fmtDateTime, timeAgo } from "@/lib/utils";
import { Alert, Async, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, TableWrap, Switch, useConfirm } from "@/components/ui";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- notifications

export function Notifications() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [unread, setUnread] = useState(false);
  const { data, loading, error, reload } = useFetch(() => get<Paged & { unread: number }>("/api/notifications", { page, unread_only: unread, page_size: 15 }), [page, unread]);
  async function readAll() { try { await post("/api/notifications/read-all"); reload(); } catch (e) { toast.error((e as Error).message); } }
  async function read(n: Rec) { if (!n.is_read) { await post(`/api/notifications/${n.id}/read`).catch(() => undefined); reload(); } }
  return (
    <>
      <PageHeader title="Notifications" description={data ? `${data.unread} unread` : undefined} actions={<><Switch checked={unread} onChange={(v) => { setUnread(v); setPage(1); }} label="Unread only" /><Button size="sm" variant="outline" onClick={readAll} disabled={!data?.unread}>Mark all as read</Button></>} />
      <Card>
        <Async loading={loading} error={error} onRetry={reload} empty={!data?.items.length} emptyNode={<EmptyState icon={<Bell className="size-7" />} title="You're all caught up" description="New notifications will appear here." />}>
          {data && <>
          <ul className="divide-y divide-line">
            {data!.items.map((n) => {
              const body = (
                <div className="flex items-start gap-3 px-5 py-4">
                  <span className={cn("mt-2 size-2.5 shrink-0 rounded-full", n.is_read ? "bg-stone-300" : "bg-accent-600")} />
                  <div className="min-w-0 flex-1"><div className={cn("text-[15px]", !n.is_read && "font-semibold")}>{n.title}</div><div className="text-sm text-muted">{n.message}</div></div>
                  <span className="shrink-0 text-xs text-muted">{timeAgo(n.created_at)}</span>
                </div>
              );
              return <li key={n.id} className={cn(!n.is_read && "bg-brand-50/50")}>{n.link ? <Link to={n.link} onClick={() => read(n)} className="block hover:bg-brand-50">{body}</Link> : <button className="block w-full text-left" onClick={() => read(n)}>{body}</button>}</li>;
            })}
          </ul>
          <Pagination page={page} pageSize={15} total={data?.total ?? 0} onChange={setPage} />
          </>}
        </Async>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- audit log

export function AuditLog() {
  const [f, setF] = useState({ q: "", action: "", date_from: "", date_to: "" });
  const dq = useDebounced(f.q);
  const [page, setPage] = useState(1);
  const actions = useFetch(() => get<string[]>("/api/audit-logs/actions"), []);
  const { data, loading, error, reload } = useFetch(() => get<Paged>("/api/audit-logs", { ...f, q: dq, page, page_size: 30 }), [dq, f.action, f.date_from, f.date_to, page]);
  const [detail, setDetail] = useState<Rec | null>(null);
  useEffect(() => setPage(1), [dq]);
  return (
    <>
      <PageHeader title="Audit log" description="A permanent record of sign-ins, changes, result workflow and result-code activity." />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <Input type="search" placeholder="Search user, record or action" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="max-w-xs" aria-label="Search audit log" />
          <Select className="w-56" value={f.action} onChange={(e) => { setF({ ...f, action: e.target.value }); setPage(1); }} aria-label="Action"><option value="">All actions</option>{actions.data?.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}</Select>
          <Input type="date" value={f.date_from} onChange={(e) => { setF({ ...f, date_from: e.target.value }); setPage(1); }} className="w-40" aria-label="From date" />
          <Input type="date" value={f.date_to} onChange={(e) => { setF({ ...f, date_to: e.target.value }); setPage(1); }} className="w-40" aria-label="To date" />
        </div>
        <Async loading={loading} error={error} onRetry={reload} empty={!data?.items.length} emptyNode={<EmptyState title="No matching activity" />}>
          {data && <>
          <TableWrap>
            <thead className="bg-stone-50"><tr><th className="th">When</th><th className="th">User</th><th className="th">Action</th><th className="th">Record</th><th className="th">IP</th><th className="th" /></tr></thead>
            <tbody>{data!.items.map((a) => (
              <tr key={a.id} className="border-t border-line"><td className="td whitespace-nowrap text-xs">{fmtDateTime(a.created_at)}</td><td className="td font-semibold">{a.user ?? <span className="font-normal text-muted">System / public</span>}</td><td className="td"><Badge tone={a.action.includes("FAIL") || a.action.includes("BLOCK") ? "red" : a.action.includes("AMEND") ? "amber" : "gray"}>{a.action.replace(/_/g, " ")}</Badge></td>
                <td className="td font-mono text-xs">{a.entity ? `${a.entity} #${a.entity_id ?? ""}` : "—"}</td><td className="td font-mono text-xs">{a.ip}</td><td className="td text-right">{a.detail && <Button size="sm" variant="ghost" onClick={() => setDetail(a)}>Details</Button>}</td></tr>
            ))}</tbody>
          </TableWrap>
          <Pagination page={page} pageSize={30} total={data?.total ?? 0} onChange={setPage} />
          </>}
        </Async>
      </Card>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.action.replace(/_/g, " ") ?? ""} size="md">
        {detail && <><dl className="mb-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted">User</dt><dd className="font-semibold">{detail.user ?? "—"}</dd></div><div><dt className="text-muted">When</dt><dd>{fmtDateTime(detail.created_at)}</dd></div><div className="col-span-2"><dt className="text-muted">Device</dt><dd className="break-all text-xs">{detail.user_agent ?? "—"}</dd></div></dl><pre className="max-h-72 overflow-auto rounded-xl bg-stone-50 p-4 text-xs">{JSON.stringify(detail.detail, null, 2)}</pre></>}
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- users

export function Users() {
  const { user: me, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch(() => get<Paged>("/api/users", { q: dq, role, page, page_size: 20 }), [dq, role, page]);
  const [create, setCreate] = useState(false);
  const [creds, setCreds] = useState<Rec | null>(null);
  useEffect(() => setPage(1), [dq, role]);

  async function act(u: Rec, action: "activate" | "deactivate" | "reset-password") {
    const msg = { activate: "Re-activate this account?", deactivate: "Deactivate this account? The user will be signed out of every session on their next request.", "reset-password": "Reset this user's password? A new temporary password will be shown once." }[action];
    if (!(await confirm({ title: u.full_name, message: msg, confirmLabel: action === "reset-password" ? "Reset" : action === "activate" ? "Activate" : "Deactivate", danger: action === "deactivate" }))) return;
    try {
      const r = await post<Rec>(`/api/users/${u.id}/${action}`);
      if (r.temporary_password) setCreds({ username: u.username, temporary_password: r.temporary_password });
      toast.success("Done");
      reload();
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <>
      <PageHeader title="User accounts" description="Manage sign-in access. Teacher and student accounts are created from the Teachers and Students pages." actions={can("users.manage_admins") && <Button size="sm" onClick={() => setCreate(true)}><Plus className="size-4" /> New administrator</Button>} />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <Input type="search" placeholder="Search name, username or email" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" aria-label="Search users" />
          <Select className="w-44" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role"><option value="">All roles</option>{["SUPER_ADMIN", "ADMIN", "TEACHER", "STUDENT"].map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}</Select>
        </div>
        <Async loading={loading} error={error} onRetry={reload} empty={!data?.items.length} emptyNode={<EmptyState title="No accounts found" />}>
          {data && <>
          <TableWrap>
            <thead className="bg-stone-50"><tr><th className="th">Name</th><th className="th">Username</th><th className="th">Role</th><th className="th">Last sign-in</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>{data!.items.map((u) => (
              <tr key={u.id} className="border-t border-line"><td className="td font-semibold">{u.full_name}<div className="text-xs font-normal text-muted">{u.email}</div></td><td className="td font-mono text-xs">{u.username}{u.is_demo && <Badge tone="amber" className="ml-2">demo</Badge>}</td><td className="td"><Badge tone={u.role.includes("ADMIN") ? "purple" : u.role === "TEACHER" ? "blue" : "gray"}>{u.role.replace("_", " ")}</Badge></td>
                <td className="td text-xs">{fmtDateTime(u.last_login_at)}</td><td className="td">{u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}</td>
                <td className="td text-right"><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" title="Reset password" aria-label="Reset password" onClick={() => act(u, "reset-password")}><KeyRound className="size-4" /></Button>
                  {u.id !== me?.id && <Button size="sm" variant="ghost" title={u.is_active ? "Deactivate" : "Activate"} aria-label={u.is_active ? "Deactivate" : "Activate"} onClick={() => act(u, u.is_active ? "deactivate" : "activate")}><Power className={`size-4 ${u.is_active ? "text-red-600" : "text-emerald-600"}`} /></Button>}</div></td></tr>
            ))}</tbody>
          </TableWrap>
          <Pagination page={page} pageSize={20} total={data?.total ?? 0} onChange={setPage} />
          </>}
        </Async>
      </Card>
      <CreateUser open={create} onClose={() => setCreate(false)} canAdmin={can("users.manage_admins")} onCreated={(c) => { setCreate(false); setCreds(c); reload(); }} />
      <Modal open={!!creds} onClose={() => setCreds(null)} title="Account credentials" size="sm" footer={<Button onClick={() => setCreds(null)}>Done</Button>}>
        {creds && <><Alert tone="warn">Share this securely. The temporary password is shown only once and must be changed at first sign-in.</Alert><dl className="mt-4 space-y-3 rounded-xl bg-stone-50 p-4 text-sm"><div><dt className="text-muted">Username</dt><dd className="font-mono text-lg font-bold">{creds.username}</dd></div><div><dt className="text-muted">Temporary password</dt><dd className="font-mono text-lg font-bold">{creds.temporary_password}</dd></div></dl></>}
      </Modal>
    </>
  );
}

function CreateUser({ open, onClose, canAdmin, onCreated }: { open: boolean; onClose: () => void; canAdmin: boolean; onCreated: (c: Rec) => void }) {
  const [f, setF] = useState({ username: "", full_name: "", email: "", phone: "", role: "ADMIN" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setF({ username: "", full_name: "", email: "", phone: "", role: "ADMIN" }); } }, [open]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await post<Rec>("/api/auth/register", { ...f, email: f.email || null, phone: f.phone || null });
      onCreated({ username: r.user.username, temporary_password: r.temporary_password });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="New administrator" size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="user-form" loading={busy}>Create</Button></>}>
      <form id="user-form" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Role" required><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{canAdmin && <option value="ADMIN">Administrator</option>}{canAdmin && <option value="SUPER_ADMIN">Super admin</option>}</Select></Field>
        <Field label="Full name" required><Input required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Username" required hint="Letters, numbers, . _ - @"><Input required minLength={3} pattern="[A-Za-z0-9._@\-]+" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- permissions

export function Permissions() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => get<Rec>("/api/permissions"), []);
  const [m, setM] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setM(data.matrix); }, [data]);
  const roles: string[] = data?.editable_roles ?? [];
  const toggle = (role: string, perm: string) => setM({ ...m, [role]: m[role].includes(perm) ? m[role].filter((p) => p !== perm) : [...m[role], perm] });
  const RESERVED = ["users.manage_admins", "backups.manage", "permissions.manage"];

  async function save() {
    setBusy(true);
    try { await put("/api/permissions", { matrix: Object.fromEntries(roles.map((r) => [r, m[r]])) }); toast.success("Permissions updated"); reload(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  const reset = () => data && setM({ ...m, ...data.defaults });

  return (
    <>
      <PageHeader title="Roles & permissions" description="Choose what each role can do. Super admins always have every permission. Teachers and students are additionally limited to their own classes or records." actions={<><Button size="sm" variant="outline" onClick={reset}><RotateCcw className="size-4" /> Reset to defaults</Button><Button size="sm" onClick={save} loading={busy}>Save changes</Button></>} />
      <Card>
        <Async loading={loading} error={error} onRetry={reload}>
          <TableWrap>
            <thead className="bg-stone-50"><tr><th className="th">Permission</th><th className="th text-center">Super admin</th>{roles.map((r) => <th key={r} className="th text-center">{r.charAt(0) + r.slice(1).toLowerCase()}</th>)}</tr></thead>
            <tbody>{data?.permissions.map((p: Rec) => (
              <tr key={p.key} className="border-t border-line"><td className="td"><div className="font-semibold">{p.description}</div><div className="font-mono text-xs text-muted">{p.key}</div></td><td className="td text-center"><input type="checkbox" checked disabled aria-label={`Super admin ${p.key}`} /></td>
                {roles.map((r) => { const locked = (r === "ADMIN" && RESERVED.includes(p.key)) || (r === "STUDENT" && p.key !== "materials.read"); return <td key={r} className="td text-center"><input type="checkbox" disabled={locked} checked={!!m[r]?.includes(p.key)} onChange={() => toggle(r, p.key)} aria-label={`${r} ${p.key}`} /></td>; })}</tr>
            ))}</tbody>
          </TableWrap>
        </Async>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- backups

export function Backups() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useFetch(() => get<Rec[]>("/api/backups"), []);
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try { await post("/api/backups"); toast.success("Backup created"); reload(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(b: Rec) {
    if (!(await confirm({ title: "Delete this backup?", message: "This cannot be undone.", confirmLabel: "Delete", danger: true }))) return;
    try { await del(`/api/backups/${b.id}`); reload(); } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <>
      <PageHeader title="Backups" description="Logical snapshots of all school data (excluding uploaded files). Keep downloaded backups somewhere safe — they contain sensitive records." actions={<Button size="sm" onClick={create} loading={busy}><DatabaseBackup className="size-4" /> Create backup</Button>} />
      <Alert tone="info" className="mb-4">Your managed PostgreSQL provider's automated backups and point-in-time recovery remain the primary disaster-recovery mechanism.</Alert>
      <Card>
        <Async loading={loading} error={error} onRetry={reload} empty={!data?.length} emptyNode={<EmptyState icon={<DatabaseBackup className="size-7" />} title="No backups yet" action={<Button onClick={create}>Create first backup</Button>} />}>
          <TableWrap><thead className="bg-stone-50"><tr><th className="th">Created</th><th className="th">By</th><th className="th">Size</th><th className="th" /></tr></thead>
            <tbody>{data?.map((b) => <tr key={b.id} className="border-t border-line"><td className="td">{fmtDateTime(b.created_at)}</td><td className="td">{b.created_by ?? "—"}</td><td className="td">{fmtBytes(b.size_bytes)}</td>
              <td className="td text-right"><Button size="sm" variant="outline" onClick={() => saveFile(`/api/backups/${b.id}/download`, `backup-${b.id}.json.gz`).catch((e) => toast.error(e.message))}><Download className="size-4" /> Download</Button><Button size="sm" variant="ghost" aria-label="Delete backup" onClick={() => remove(b)}><Trash2 className="size-4 text-red-600" /></Button></td></tr>)}</tbody></TableWrap>
        </Async>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- my account

export function Account() {
  const { user, reload, logout } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ current_password: "", new_password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.new_password !== f.confirm) { setError("The new passwords do not match."); return; }
    setBusy(true);
    setError(null);
    try { await post("/api/auth/change-password", { current_password: f.current_password, new_password: f.new_password }); toast.success("Password changed"); setF({ current_password: "", new_password: "", confirm: "" }); await reload(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader title="My account" />
      {user?.must_change_password && <Alert tone="warn" className="mb-5">For your security, please choose a new password before continuing.</Alert>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader title="Profile" /><dl className="space-y-3 p-5 text-sm"><div><dt className="text-muted">Name</dt><dd className="font-semibold">{user?.full_name}</dd></div><div><dt className="text-muted">Username</dt><dd className="font-mono">{user?.username}</dd></div><div><dt className="text-muted">Role</dt><dd className="capitalize">{user?.role.replace("_", " ").toLowerCase()}</dd></div><div><dt className="text-muted">Email</dt><dd>{user?.email ?? "—"}</dd></div></dl>
          <div className="border-t border-line p-5"><Button variant="outline" onClick={logout}>Sign out</Button></div></Card>
        <Card><CardHeader title="Change password" />
          <form onSubmit={submit} className="space-y-4 p-5">
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Current password"><Input required type="password" autoComplete="current-password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></Field>
            <Field label="New password" hint="At least 8 characters, with letters and numbers."><Input required type="password" minLength={8} autoComplete="new-password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field>
            <Field label="Confirm new password"><Input required type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
            <Button type="submit" loading={busy}>Update password</Button>
          </form></Card>
      </div>
    </>
  );
}
