import { useEffect } from "react";
import { createPortal } from "react-dom";
import { GraduationCap } from "lucide-react";
import type { Rec } from "@/lib/api";
import { useSchool } from "@/lib/school";

function Card({ c }: { c: Rec }) {
  const { school, logo } = useSchool();
  return (
    <div className="scratch-card overflow-hidden rounded-xl border-2 border-dashed border-brand-700 bg-white text-black" style={{ height: "62mm" }}>
      <div className="flex items-center gap-2 bg-brand-700 px-3 py-2 text-white">
        {logo ? <img src={logo} alt="" className="size-9 rounded-full bg-white object-contain" /> : <GraduationCap className="size-8" />}
        <div className="leading-tight"><div className="text-[11px] font-bold uppercase">{school?.name}</div><div className="text-[10px] font-semibold tracking-wider">RESULT CHECKING CARD</div></div>
      </div>
      <div className="px-3 pt-2">
        <div className="text-[9px] text-neutral-600">Serial Number:</div>
        <div className="text-[15px] font-bold leading-tight">{c.serial}</div>
        <div className="mt-1 text-[9px] text-neutral-600">Access PIN:</div>
        <div className="rounded bg-neutral-200 py-1 text-center font-mono text-[17px] font-bold tracking-widest">{c.pin}</div>
        <ol className="mt-1.5 list-decimal pl-4 text-[8.5px] leading-[1.35]">
          <li>Visit the school's result portal.</li><li>Enter your student ID.</li><li>Enter the access PIN.</li><li>Select your session and term.</li><li>View your result.</li>
        </ol>
        <div className="mt-1 text-[7.5px] text-neutral-500">{[c.session, c.term].filter(Boolean).join(" · ")} {school?.website}</div>
      </div>
    </div>
  );
}

/** Printable A4 sheet of scratch cards, rendered outside #root so only it prints. */
export function PrintableCards({ cards }: { cards: Rec[] }) {
  useEffect(() => {
    const cleanup = () => document.body.classList.remove("print-cards");
    window.addEventListener("afterprint", cleanup);
    return () => { window.removeEventListener("afterprint", cleanup); cleanup(); };
  }, []);
  return createPortal(
    <div id="print-cards" className="grid-cols-2 gap-3" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
      {cards.map((c) => <Card key={c.serial} c={c} />)}
    </div>,
    document.body,
  );
}

export function printCards() {
  document.body.classList.add("print-cards");
  window.print();
}
