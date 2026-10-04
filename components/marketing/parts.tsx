/** Pieces shared by the marketing pages. */

export const FAQS: { q: string; a: string }[] = [
  { q: "Do we need internet in the computer lab?", a: "Only to start and to finish syncing. During the exam, answers are stored on each PC and uploaded when the connection is available, so a dropped network or a restarted PC doesn't lose work." },
  { q: "Can SonoCBT lock down a student's own phone or laptop?", a: "No, and we won't pretend otherwise: a web page can't fully lock a personal device. SonoCBT detects and records leaving the exam window, copying and pasting, and second sign-ins, and can submit automatically after repeated switching. For main exams most schools use their lab PCs with the Strict preset." },
  { q: "Which students do we pay for?", a: "Students on your active class register for the term. Graduated or withdrawn students are not billed. You pay at the start of each term by card or bank transfer through Paystack." },
  { q: "Can teachers keep writing questions in Word?", a: "Yes. Upload the .docx you already use: SonoCBT finds the questions, options and answers (including maths and pictures) and flags anything it isn't sure about for a teacher to check." },
  { q: "Can we move our old results in?", a: "Yes. Send us your broadsheets as Excel files and we import them during setup." },
  { q: "Do parents need an app?", a: "No. Parents check released results on their phone's browser with a scratch-card PIN, download the report card as a PDF, and can scan its QR code to confirm it's genuine." },
];

export function Faq({ items = FAQS }: { items?: { q: string; a: string }[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((f) => (
        <details key={f.q} className="group rounded-xl border border-border bg-card px-5 py-4">
          <summary className="cursor-pointer list-none text-base font-bold marker:hidden">
            <span className="mr-2 inline-block transition-transform group-open:rotate-90" aria-hidden>
              ›
            </span>
            {f.q}
          </summary>
          <p className="mt-2.5 text-[15px] leading-relaxed text-ink-2">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

/** A phone showing one exam question, like the runtime (static, no JS). */
export function PhoneMock() {
  const opts = ["x = 4", "x = 6", "x = 4⁄3", "x = 18"];
  return (
    <div className="relative mx-auto w-[300px] rounded-[38px] border-[10px] border-ink bg-ink shadow-[0_24px_60px_rgba(20,33,61,.25)]" aria-label="An exam question on a phone" role="img">
      <div className="overflow-hidden rounded-[28px] bg-[#FAF8F3]">
        <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <span className="text-xs font-bold">Q12 of 30</span>
          <span className="rounded-md bg-ink px-2 py-0.5 font-mono text-xs font-semibold text-white">41:18</span>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <div className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Mathematics</div>
          <p className="font-exam text-[17px] leading-snug">
            Solve for <i>x</i>: 3<i>x</i> − 7 = 11
          </p>
          {opts.map((o, i) => (
            <div key={o} className={i === 1 ? "flex items-center gap-3 rounded-xl border-2 border-ink bg-[#FFF4CC] px-3 py-2.5" : "flex items-center gap-3 rounded-xl border-[1.5px] border-input bg-card px-3 py-2.5"}>
              <span className={i === 1 ? "flex size-7 items-center justify-center rounded-full bg-ink text-xs font-bold text-white" : "flex size-7 items-center justify-center rounded-full border-[1.5px] border-input text-xs font-bold"}>{"ABCD"[i]}</span>
              <span className="font-exam text-[15px]">{o}</span>
            </div>
          ))}
          <div className="mt-1 rounded-lg bg-[#E8F4EC] px-3 py-2 text-xs font-semibold text-[#155E34]">✓ Saved on this device</div>
        </div>
      </div>
    </div>
  );
}
