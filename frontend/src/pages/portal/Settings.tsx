import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ImageUp } from "lucide-react";
import { get, put, upload, type Rec } from "@/lib/api";
import { useAuthImage, useFetch, useToast } from "@/lib/hooks";
import { useSchool } from "@/lib/school";
import { nullify } from "@/lib/utils";
import { Alert, Async, Button, Card, CardHeader, Field, Input, PageHeader, Switch, Tabs, Textarea } from "@/components/ui";

type Tab = "school" | "brand" | "about" | "results" | "codes";
const FIELDS = ["name", "short_name", "motto", "address", "phone", "email", "website", "facebook", "instagram", "twitter", "youtube", "map_embed_url", "primary_color", "secondary_color", "principal_name", "principal_title", "principal_message", "history", "vision", "mission", "philosophy", "ca_max", "exam_max", "require_approval", "allow_teacher_self_approval", "show_position", "code_prefix", "code_default_max_uses", "code_default_expiry_days", "result_footer_note"];

function AssetUpload({ kind, label, has, onDone, hint }: { kind: string; label: string; has: boolean; onDone: () => void; hint: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState(0);
  const preview = useAuthImage(has ? `/api/settings/assets/${kind}?v=${v}` : null);
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    try { await upload(`/api/settings/assets/${kind}`, fd); toast.success(`${label} updated`); setV((x) => x + 1); onDone(); } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); e.target.value = ""; }
  }
  return (
    <div className="flex items-center gap-4 rounded-xl border border-line p-4">
      <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-stone-100 bg-[linear-gradient(45deg,#e7e5e4_25%,transparent_25%,transparent_75%,#e7e5e4_75%),linear-gradient(45deg,#e7e5e4_25%,transparent_25%,transparent_75%,#e7e5e4_75%)] bg-[length:12px_12px] bg-[position:0_0,6px_6px]">{preview ? <img src={preview} alt={label} className="max-h-full max-w-full object-contain" /> : <ImageUp className="size-6 text-muted" />}</div>
      <div className="min-w-0 flex-1"><div className="font-semibold">{label}</div><div className="text-xs text-muted">{hint}</div>
        <label className="mt-2 inline-block cursor-pointer text-sm font-semibold text-brand-700 hover:underline">{busy ? "Uploading…" : has ? "Replace" : "Upload"}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pick} disabled={busy} /></label></div>
    </div>
  );
}

export default function SchoolSettings() {
  const toast = useToast();
  const { reload: reloadSchool } = useSchool();
  const { data, loading, error, reload } = useFetch(() => get<Rec>("/api/settings"), []);
  const [tab, setTab] = useState<Tab>("school");
  const [f, setF] = useState<Rec>({});
  const [values, setValues] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setF(Object.fromEntries(FIELDS.map((k) => [k, data[k] ?? (typeof data[k] === "boolean" ? false : "")])));
    setValues((data.core_values ?? []).join("\n"));
  }, [data]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const num = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body = nullify({
        ...f,
        ca_max: Number(f.ca_max), exam_max: Number(f.exam_max), code_default_max_uses: Number(f.code_default_max_uses), code_default_expiry_days: Number(f.code_default_expiry_days),
        core_values: values.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      await put("/api/settings", body);
      toast.success("Settings saved");
      reload(); reloadSchool();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const refresh = () => { reload(); reloadSchool(); };

  return (
    <>
      <PageHeader title="School settings" description="School identity, branding, result rules and result-code defaults." actions={<Button onClick={save} loading={busy}>Save changes</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "school", label: "School & contact" }, { id: "brand", label: "Branding & assets" }, { id: "about", label: "About content" }, { id: "results", label: "Results & workflow" }, { id: "codes", label: "Result codes" }]} />
      <Async loading={loading} error={error} onRetry={reload} rows={6}>
        {err && <Alert tone="error" className="mb-4">{err}</Alert>}
        {tab === "school" && (
          <Card><CardHeader title="School & contact" /><div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="School name" required><Input value={f.name ?? ""} onChange={set("name")} /></Field>
            <Field label="Short name" hint="Used on cards and titles"><Input value={f.short_name ?? ""} onChange={set("short_name")} /></Field>
            <Field label="Motto" className="sm:col-span-2"><Input value={f.motto ?? ""} onChange={set("motto")} /></Field>
            <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={f.address ?? ""} onChange={set("address")} /></Field>
            <Field label="Phone"><Input value={f.phone ?? ""} onChange={set("phone")} /></Field>
            <Field label="Email"><Input type="email" value={f.email ?? ""} onChange={set("email")} /></Field>
            <Field label="Website" hint="Full URL, e.g. https://school.example.com"><Input value={f.website ?? ""} onChange={set("website")} /></Field>
            <Field label="Facebook URL"><Input value={f.facebook ?? ""} onChange={set("facebook")} /></Field>
            <Field label="Instagram URL"><Input value={f.instagram ?? ""} onChange={set("instagram")} /></Field>
            <Field label="X / Twitter URL"><Input value={f.twitter ?? ""} onChange={set("twitter")} /></Field>
            <Field label="YouTube URL"><Input value={f.youtube ?? ""} onChange={set("youtube")} /></Field>
            <Field label="Google Maps embed URL" hint="Google Maps → Share → Embed a map → copy the src URL" className="sm:col-span-2"><Input value={f.map_embed_url ?? ""} onChange={set("map_embed_url")} placeholder="https://www.google.com/maps/embed?pb=…" /></Field>
            <div className="sm:col-span-2"><Alert tone="info">The current session and term are set under <Link className="font-semibold underline" to="/portal/academics">Sessions &amp; classes</Link>. The grading scale is edited there too.</Alert></div>
          </div></Card>
        )}
        {tab === "brand" && (
          <div className="space-y-5">
            <Card><CardHeader title="Colours" description="The whole portal and public website adopt these colours." /><div className="grid gap-4 p-5 sm:grid-cols-2">
              {[["primary_color", "Primary colour"], ["secondary_color", "Accent colour"]].map(([k, l]) => (
                <Field key={k} label={l}><div className="flex items-center gap-3"><input type="color" value={f[k] || "#14532d"} onChange={set(k)} className="h-11 w-16 cursor-pointer rounded-lg border border-line bg-white p-1" aria-label={l} /><Input value={f[k] ?? ""} onChange={set(k)} className="w-32 font-mono" maxLength={7} /></div></Field>
              ))}
            </div></Card>
            <Card><CardHeader title="Images" description="PNG with a transparent background works best for logo, stamp and signature." /><div className="grid gap-4 p-5 lg:grid-cols-2">
              <AssetUpload kind="logo" label="School logo" has={!!data?.has_logo} onDone={refresh} hint="Shown in the header, report cards and scratch cards." />
              <AssetUpload kind="hero" label="Homepage hero image" has={!!data?.has_hero} onDone={refresh} hint="Wide photo of the school, at least 1600px wide." />
              <AssetUpload kind="stamp" label="School stamp" has={!!data?.has_stamp} onDone={refresh} hint="Printed on the PDF report card." />
              <AssetUpload kind="signature" label="Principal's signature" has={!!data?.has_signature} onDone={refresh} hint="Printed on the PDF report card." />
            </div></Card>
            <Card><CardHeader title="Principal" /><div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Name"><Input value={f.principal_name ?? ""} onChange={set("principal_name")} /></Field>
              <Field label="Title"><Input value={f.principal_title ?? ""} onChange={set("principal_title")} /></Field>
              <Field label="Message to parents" className="sm:col-span-2"><Textarea rows={5} value={f.principal_message ?? ""} onChange={set("principal_message")} /></Field>
            </div></Card>
          </div>
        )}
        {tab === "about" && (
          <Card><CardHeader title="About page content" /><div className="grid gap-4 p-5">
            <Field label="History"><Textarea rows={4} value={f.history ?? ""} onChange={set("history")} /></Field>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Vision"><Textarea rows={3} value={f.vision ?? ""} onChange={set("vision")} /></Field><Field label="Mission"><Textarea rows={3} value={f.mission ?? ""} onChange={set("mission")} /></Field></div>
            <Field label="Academic philosophy"><Textarea rows={3} value={f.philosophy ?? ""} onChange={set("philosophy")} /></Field>
            <Field label="Core values" hint="One per line"><Textarea rows={5} value={values} onChange={(e) => setValues(e.target.value)} /></Field>
          </div></Card>
        )}
        {tab === "results" && (
          <Card><CardHeader title="Results & workflow" /><div className="grid gap-5 p-5 sm:grid-cols-2">
            <Field label="Maximum CA / test score" hint="Changing this also checks the grading scale"><Input type="number" min={1} max={100} value={f.ca_max ?? ""} onChange={num("ca_max")} /></Field>
            <Field label="Maximum examination score"><Input type="number" min={1} max={100} value={f.exam_max ?? ""} onChange={num("exam_max")} /></Field>
            <div className="space-y-4 sm:col-span-2">
              <Switch checked={!!f.require_approval} onChange={(v) => setF({ ...f, require_approval: v })} label="Require administrator approval before results are published" />
              <Switch checked={!!f.allow_teacher_self_approval} onChange={(v) => setF({ ...f, allow_teacher_self_approval: v })} label="Allow teachers to approve and publish their own submitted results" />
              <Switch checked={!!f.show_position} onChange={(v) => setF({ ...f, show_position: v })} label="Show class positions on report cards" />
            </div>
            <Field label="Report card footer note" className="sm:col-span-2"><Input value={f.result_footer_note ?? ""} onChange={set("result_footer_note")} /></Field>
          </div></Card>
        )}
        {tab === "codes" && (
          <Card><CardHeader title="Result-code defaults" description="Used when generating cards without specific values." /><div className="grid gap-4 p-5 sm:grid-cols-3">
            <Field label="PIN prefix" hint="2–6 letters, e.g. SCH"><Input value={f.code_prefix ?? ""} onChange={(e) => setF({ ...f, code_prefix: e.target.value.toUpperCase() })} maxLength={6} /></Field>
            <Field label="Allowed uses per card"><Input type="number" min={1} max={100} value={f.code_default_max_uses ?? ""} onChange={num("code_default_max_uses")} /></Field>
            <Field label="Default validity (days)" hint="0 = never expires"><Input type="number" min={0} value={f.code_default_expiry_days ?? ""} onChange={num("code_default_expiry_days")} /></Field>
          </div></Card>
        )}
      </Async>
    </>
  );
}
