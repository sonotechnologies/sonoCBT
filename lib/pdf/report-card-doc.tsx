/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image> is not an HTML img and has no alt. */
/**
 * A4 report sheet (the "Report card" design), drawn with @react-pdf/renderer.
 * Built-in Helvetica/Courier keep it fast and dependable on any server.
 */
import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate, num } from "@/lib/format";
import { ordinal } from "@/lib/grading";
import { RATING_KEY } from "@/lib/results/extras-model";
import type { Rating, ReportCard } from "@/lib/results/report-card";
import type { PdfImage } from "./assets";

export type CardAssets = {
  logo: PdfImage | null;
  photo: PdfImage | null;
  signature: PdfImage | null;
  qr: PdfImage | null;
  verifyHost: string;
};

// Never split words (URLs, names, codes) across lines with a hyphen.
Font.registerHyphenationCallback((word) => [word]);

const INK = "#111827";
const MUTED = "#4B5563";
const LINE = "#9CA3AF";
const HEAD = "#6B7280";
const FILL = "#F3F4F6";

const s = StyleSheet.create({
  page: { paddingTop: 24, paddingBottom: 20, paddingHorizontal: 28, fontFamily: "Helvetica", fontSize: 8, color: INK },
  header: { flexDirection: "row", alignItems: "center", paddingBottom: 8, borderBottomWidth: 2.2 },
  crest: { width: 58, height: 58, borderRadius: 29, borderWidth: 0.75, borderColor: LINE, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photo: { width: 58, height: 68, borderWidth: 0.75, borderColor: LINE, alignItems: "center", justifyContent: "center" },
  schoolName: { fontSize: 17, fontFamily: "Helvetica-Bold", letterSpacing: 0.6, textAlign: "center" },
  small: { fontSize: 8, textAlign: "center", marginTop: 2 },
  sheetTitle: { fontSize: 9.5, fontFamily: "Helvetica-Bold", letterSpacing: 0.8, textAlign: "center", marginTop: 4 },
  label: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: MUTED, textTransform: "uppercase", letterSpacing: 0.3 },
  value: { fontSize: 8.5, fontFamily: "Helvetica-Bold", marginTop: 1 },
  th: { fontSize: 6.5, fontFamily: "Helvetica-Bold", paddingVertical: 3, paddingHorizontal: 2, borderRightWidth: 0.6, borderColor: HEAD, textAlign: "center" },
  td: { fontSize: 7.5, paddingVertical: 2.6, paddingHorizontal: 2, borderRightWidth: 0.6, borderColor: LINE, textAlign: "center", fontFamily: "Courier" },
  row: { flexDirection: "row", borderBottomWidth: 0.6, borderColor: LINE },
  mono: { fontFamily: "Courier" },
  watermark: { position: "absolute", top: 360, left: 40, fontSize: 52, color: "#DC2626", opacity: 0.12, transform: "rotate(-30deg)", fontFamily: "Helvetica-Bold" },
});

function Placeholder({ text }: { text: string }) {
  return <Text style={{ fontSize: 6.5, color: MUTED, fontFamily: "Courier" }}>{text}</Text>;
}

function Ratings({ title, items }: { title: string; items: Rating[] }) {
  return (
    <View style={{ flex: 1, borderWidth: 0.6, borderColor: HEAD, borderBottomWidth: 0 }}>
      <View style={[s.row, { backgroundColor: FILL, borderColor: HEAD }]}>
        <Text style={[s.th, { flex: 1, textAlign: "left", paddingLeft: 4 }]}>{title}</Text>
        {[5, 4, 3, 2, 1].map((n) => (
          <Text key={n} style={[s.th, { width: 16 }, n === 1 ? { borderRightWidth: 0 } : {}]}>
            {n}
          </Text>
        ))}
      </View>
      {items.map((it) => (
        <View key={it.key} style={s.row}>
          <Text style={{ flex: 1, fontSize: 7.5, paddingVertical: 2.4, paddingLeft: 4, borderRightWidth: 0.6, borderColor: LINE }}>{it.name}</Text>
          {[5, 4, 3, 2, 1].map((n) => (
            <View key={n} style={{ width: 16, borderRightWidth: n === 1 ? 0 : 0.6, borderColor: LINE, alignItems: "center", justifyContent: "center" }}>
              {it.value === n ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: INK }} /> : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function ReportCardPage({ card: c, assets: a }: { card: ReportCard; assets: CardAssets }) {
  const brand = c.school.brandColor ?? "#14213D";
  const details: [string, string][] = [
    ["Name", c.student.formalName],
    ["Admission no.", c.student.admissionNo],
    ["Class", c.classArmName],
    ["Gender · Age", [c.student.gender, c.student.age !== null ? String(c.student.age) : null].filter(Boolean).join(" · ") || "—"],
    ["No. in class", String(c.numberInClass)],
    ["Times school opened", c.daysOpened !== null ? String(c.daysOpened) : "—"],
    ["Times present", c.daysPresent !== null ? String(c.daysPresent) : "—"],
    ["Session", c.sessionName],
  ];
  const cum = c.cumulative;
  // Column widths (points). Subject and remark flex; numbers are fixed.
  const n = 21;
  const cols: { label: string; sub: string; width?: number; flex?: number; align?: "left" | "center" }[] = [
    { label: "Subject", sub: "", flex: 2.4, align: "left" },
    ...c.components.map((k) => ({ label: k.name, sub: String(k.weight), width: n + 3 })),
    { label: "Total", sub: "100", width: n + 4 },
    { label: "Grade", sub: "", width: n },
    { label: "Pos.", sub: "", width: n + 5 },
    { label: "High", sub: "est", width: n },
    { label: "Low", sub: "est", width: n },
    { label: "Class", sub: "avg", width: n + 2 },
    ...(cum
      ? [
          { label: "1st", sub: "term", width: n + 2 },
          { label: "2nd", sub: "term", width: n + 2 },
          { label: "Annual", sub: "avg", width: n + 6 },
        ]
      : []),
    { label: "Remark", sub: "", flex: 1.3, align: "left" as const },
  ];
  const cell = (i: number, last = false) => ({
    ...(cols[i].width ? { width: cols[i].width } : { flex: cols[i].flex }),
    ...(cols[i].align === "left" ? { textAlign: "left" as const, paddingLeft: 4 } : {}),
    ...(last ? { borderRightWidth: 0 } : {}),
  });

  const summary: [string, string][] = [
    ["Subjects", String(c.subjects.length)],
    ["Total score", `${num(c.total)}/${c.subjects.length * 100}`],
    ["Average", `${num(c.average)}%`],
    ["Class average", `${num(c.classAverage)}%`],
    ["Position", `${ordinal(c.position)} / ${c.numberInClass}`],
    cum ? ["Annual average", `${num(cum.annualAverage)}%`] : ["Overall", `${c.overall.grade} · ${c.overall.remark}`],
  ];

  return (
    <Page size="A4" style={s.page}>
      {!c.released && (
        <Text style={s.watermark} fixed>
          PREVIEW · NOT RELEASED
        </Text>
      )}
      <View style={[s.header, { borderColor: brand }]}>
        <View style={s.crest}>{a.logo ? <Image src={a.logo} style={{ width: 58, height: 58, objectFit: "contain" }} /> : <Placeholder text="crest" />}</View>
        <View style={{ flex: 1, paddingHorizontal: 10 }}>
          <Text style={[s.schoolName, { color: brand }]}>{c.school.name.toUpperCase()}</Text>
          <Text style={s.small}>{[c.school.address, c.school.phone, c.school.email].filter(Boolean).join(" · ")}</Text>
          {c.school.motto ? <Text style={[s.small, { fontFamily: "Helvetica-Oblique" }]}>Motto: {c.school.motto}</Text> : null}
          <Text style={s.sheetTitle}>STUDENT REPORT SHEET · {c.termLabel.toUpperCase()}</Text>
        </View>
        <View style={s.photo}>{a.photo ? <Image src={a.photo} style={{ width: 58, height: 68, objectFit: "cover" }} /> : <Placeholder text="photo" />}</View>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", borderWidth: 0.75, borderColor: HEAD, marginTop: 8 }}>
        {details.map(([k, v], i) => (
          <View key={k} style={{ width: "25%", paddingVertical: 3.5, paddingHorizontal: 6, borderRightWidth: i % 4 === 3 ? 0 : 0.6, borderBottomWidth: i < 4 ? 0.6 : 0, borderColor: "#D1D5DB" }}>
            <Text style={s.label}>{k}</Text>
            <Text style={s.value}>{v}</Text>
          </View>
        ))}
      </View>

      <View style={{ marginTop: 8, borderWidth: 0.75, borderColor: HEAD, borderBottomWidth: 0 }}>
        <View style={[s.row, { backgroundColor: FILL, borderColor: HEAD }]}>
          {cols.map((col, i) => (
            <View key={col.label + i} style={[s.th, cell(i, i === cols.length - 1)]}>
              <Text>{col.label}</Text>
              {col.sub ? <Text style={{ fontFamily: "Helvetica" }}>{col.sub}</Text> : null}
            </View>
          ))}
        </View>
        {c.subjects.map((sub, r) => {
          const cu = cum?.subjects[r];
          const vals = [
            sub.name,
            ...sub.components.map((x) => num(x.value)),
            num(sub.total),
            sub.grade,
            ordinal(sub.position),
            num(sub.highest),
            num(sub.lowest),
            num(sub.classAverage),
            ...(cum ? [num(cu?.totals[0] ?? null), num(cu?.totals[1] ?? null), num(cu?.annualAverage ?? null)] : []),
            sub.remark,
          ];
          return (
            <View key={sub.name} style={s.row} wrap={false}>
              {vals.map((v, i) => (
                <Text
                  key={i}
                  style={[
                    s.td,
                    cell(i, i === vals.length - 1),
                    i === 0 || i === vals.length - 1 ? { fontFamily: i === 0 ? "Helvetica-Bold" : "Helvetica" } : {},
                    cols[i].label === "Total" || cols[i].label === "Grade" ? { fontFamily: "Courier-Bold" } : {},
                  ]}
                >
                  {v}
                </Text>
              ))}
            </View>
          );
        })}
      </View>

      <View style={{ flexDirection: "row", borderWidth: 1.1, borderColor: INK, marginTop: 8 }}>
        {summary.map(([k, v], i) => (
          <View key={k} style={{ flex: 1, paddingVertical: 4, borderRightWidth: i === summary.length - 1 ? 0 : 0.6, borderColor: LINE, alignItems: "center" }}>
            <Text style={s.label}>{k}</Text>
            <Text style={{ fontFamily: "Courier-Bold", fontSize: 10.5, marginTop: 2 }}>{v}</Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", gap: 9, marginTop: 8 }}>
        <Ratings title="AFFECTIVE DOMAIN" items={c.affective} />
        <Ratings title="PSYCHOMOTOR SKILLS" items={c.psychomotor} />
      </View>
      <Text style={{ fontSize: 6.5, color: "#374151", marginTop: 3 }}>Key: {RATING_KEY}.</Text>

      <View style={{ borderWidth: 0.75, borderColor: HEAD, marginTop: 7, fontSize: 8 }}>
        <Text style={{ paddingVertical: 5, paddingHorizontal: 7, borderBottomWidth: 0.6, borderColor: "#D1D5DB" }}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Form teacher&apos;s remark: </Text>
          {c.formTeacherRemark ?? "—"}
          {c.formTeacherRemark && c.formTeacherName ? <Text style={{ fontFamily: "Helvetica-Oblique" }}> — {c.formTeacherName}</Text> : null}
        </Text>
        <Text style={{ paddingVertical: 5, paddingHorizontal: 7 }}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Principal&apos;s remark: </Text>
          {c.principalRemark ?? "—"}
        </Text>
      </View>

      <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", gap: 12, marginTop: 8 }}>
        <View style={{ flex: 1, gap: 4, fontSize: 8 }}>
          <Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>Next term begins: </Text>
            <Text style={s.mono}>{c.nextResumesOn ? formatDate(new Date(`${c.nextResumesOn}T12:00:00Z`)) : "To be announced"}</Text>
          </Text>
          <Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>Result issued: </Text>
            <Text style={s.mono}>{c.issuedOn ? formatDate(c.issuedOn) : "Not yet released"}</Text>
          </Text>
        </View>
        <View style={{ flex: 1, alignItems: "center" }}>
          <View style={{ height: 32, width: "100%", borderBottomWidth: 0.75, borderColor: INK, alignItems: "center", justifyContent: "flex-end" }}>
            {a.signature ? <Image src={a.signature} style={{ height: 30, objectFit: "contain" }} /> : null}
          </View>
          <Text style={{ fontSize: 7.5, fontFamily: "Helvetica-Bold", marginTop: 3 }}>{c.school.principalName ? `${c.school.principalName}, Principal` : "Principal"}</Text>
        </View>
        <View style={{ width: 84, alignItems: "center" }}>
          {a.qr ? <Image src={a.qr} style={{ width: 70, height: 70 }} /> : <View style={{ width: 70, height: 70, borderWidth: 0.75, borderColor: HEAD }} />}
          <Text style={{ fontFamily: "Courier", fontSize: 7, marginTop: 3 }}>{c.verifyCode ?? "not yet issued"}</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.6, borderColor: "#D1D5DB", paddingTop: 5, marginTop: 6, fontSize: 6.8, color: "#374151" }}>
        <Text>Verify this result at {a.verifyHost}/verify or scan the QR code.</Text>
        <Text>Generated by SonoCBT</Text>
      </View>
    </Page>
  );
}

export function ReportCardsDocument({ pages, title }: { pages: { card: ReportCard; assets: CardAssets }[]; title: string }) {
  return (
    <Document title={title} author="SonoCBT" creator="SonoCBT" producer="SonoCBT">
      {pages.map((p) => (
        <ReportCardPage key={p.card.student.id} card={p.card} assets={p.assets} />
      ))}
    </Document>
  );
}
