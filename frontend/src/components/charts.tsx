import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Rec } from "@/lib/api";

const PALETTE = ["#14532d", "#b45309", "#2563eb", "#7c3aed", "#0f766e", "#be123c", "#64748b"];
const GRADE = { A: "#15803d", B: "#65a30d", C: "#0284c7", D: "#d97706", E: "#ea580c", F: "#dc2626" } as Record<string, string>;

export function BarBox({ data, color = "#14532d", height = 240, horizontal = false }: { data: Rec[]; color?: string; height?: number; horizontal?: boolean }) {
  if (!data.some((d) => d.value > 0)) return <Empty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 8, bottom: 0, left: horizontal ? 24 : -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e1d6" vertical={false} />
        {horizontal ? <><XAxis type="number" tick={{ fontSize: 12 }} /><YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12 }} /></> : <><XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /></>}
        <Tooltip cursor={{ fill: "rgba(20,83,45,.06)" }} contentStyle={{ borderRadius: 10, border: "1px solid #e5e1d6" }} />
        <Bar dataKey="value" fill={color} radius={[6, 6, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PieBox({ data, height = 240, grades = false }: { data: Rec[]; height?: number; grades?: boolean }) {
  const visible = data.filter((d) => d.value > 0);
  if (!visible.length) return <Empty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={visible} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="82%" paddingAngle={2}>
          {visible.map((d, i) => <Cell key={d.name} fill={grades ? GRADE[d.name] ?? PALETTE[i % PALETTE.length] : PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e5e1d6" }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

const Empty = ({ height }: { height: number }) => <div style={{ height }} className="grid place-items-center text-sm text-muted">No data to chart yet</div>;
