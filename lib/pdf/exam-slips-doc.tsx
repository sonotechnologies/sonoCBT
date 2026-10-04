/** Exam slips (10 to an A4 page, with cut lines) and the invigilator's PIN sheet, per class. */
import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

export type SlipClass = {
  name: string;
  venue: string | null;
  slips: { studentId: string; name: string; admissionNo: string; seat: string | null; className: string; venue: string | null; pin: string | null }[];
};
export type SlipsInfo = { school: string; exam: string; when: string; signInUrl: string; brand: string };

// Never split words (names, codes, URLs) across lines with a hyphen.
Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  slipsPage: { padding: 22, fontFamily: "Helvetica", fontSize: 8, color: "#111827", flexDirection: "row", flexWrap: "wrap" },
  // A4 is 595 × 842 pt; 22 pt margins leave 551 × 798 for 2 × 5 slips.
  slip: { width: 275, height: 159, paddingVertical: 11, paddingHorizontal: 13, borderWidth: 0.6, borderStyle: "dashed", borderColor: "#9CA3AF", justifyContent: "space-between" },
  sheetPage: { paddingTop: 34, paddingBottom: 40, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: 9.5, color: "#111827" },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8.5, paddingVertical: 5 },
  td: { paddingVertical: 6.5 },
});

export function ExamSlipsDocument({ info, classes }: { info: SlipsInfo; classes: SlipClass[] }) {
  return (
    <Document title={`${info.exam} · exam slips`} author="SonoCBT" creator="SonoCBT" producer="SonoCBT">
      {classes.flatMap((c) => {
        const pages: SlipClass["slips"][] = [];
        for (let i = 0; i < c.slips.length; i += 10) pages.push(c.slips.slice(i, i + 10));
        return pages.map((group, p) => (
          <Page key={`${c.name}-${p}`} size="A4" style={s.slipsPage}>
            {group.map((x) => (
              <View key={x.studentId} style={s.slip} wrap={false}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", fontSize: 6.8, fontFamily: "Helvetica-Bold", letterSpacing: 0.3 }}>
                  <Text style={{ maxWidth: 170, color: info.brand }}>{`${info.school} · ${info.exam}`.toUpperCase()}</Text>
                  <Text>{info.when}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11.5 }}>{x.name}</Text>
                    <Text style={{ fontFamily: "Courier", fontSize: 8, marginTop: 2 }}>
                      {x.admissionNo} · {x.className}
                    </Text>
                    <Text style={{ fontSize: 8.5, marginTop: 2 }}>
                      <Text style={{ fontFamily: "Helvetica-Bold" }}>Seat {x.seat ?? "—"}</Text>
                      {x.venue ? ` · ${x.venue}` : ""}
                    </Text>
                  </View>
                  {x.pin ? (
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 6.5 }}>EXAM PIN</Text>
                      <Text style={{ fontFamily: "Courier-Bold", fontSize: 17, letterSpacing: 1 }}>{x.pin}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={{ fontSize: 6.8, color: "#374151" }}>Sign in at {info.signInUrl} with your admission number. Keep this slip private.</Text>
              </View>
            ))}
          </Page>
        ));
      })}
    </Document>
  );
}

export function ExamPinSheetDocument({ info, classes }: { info: SlipsInfo; classes: SlipClass[] }) {
  const cols = [
    { label: "Seat", width: 40 },
    { label: "Student", flex: 1 },
    { label: "Admission no.", width: 110 },
    { label: "PIN", width: 80 },
    { label: "Signed", width: 90 },
  ];
  const cell = (i: number) => (cols[i].width ? { width: cols[i].width } : { flex: cols[i].flex });
  return (
    <Document title={`${info.exam} · PIN sheet`} author="SonoCBT" creator="SonoCBT" producer="SonoCBT">
      {classes.map((c) => (
        <Page key={c.name} size="A4" style={s.sheetPage}>
          <View fixed style={{ marginBottom: 8 }}>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 13, color: info.brand }}>
              {info.school} · {info.exam}
            </Text>
            <Text style={{ marginTop: 2 }}>
              {c.name}
              {c.venue ? ` · ${c.venue}` : ""} · {info.when}. Keep this sheet with the invigilator.
            </Text>
            <View style={{ flexDirection: "row", borderBottomWidth: 1.4, borderColor: "#111827", marginTop: 10 }}>
              {cols.map((col, i) => (
                <Text key={col.label} style={[s.th, cell(i)]}>
                  {col.label}
                </Text>
              ))}
            </View>
          </View>
          {c.slips.map((x) => (
            <View key={x.studentId} wrap={false} style={{ flexDirection: "row", borderBottomWidth: 0.6, borderColor: "#BBBBBB" }}>
              <Text style={[s.td, cell(0), { fontFamily: "Courier" }]}>{x.seat ?? "—"}</Text>
              <Text style={[s.td, cell(1)]}>{x.name}</Text>
              <Text style={[s.td, cell(2), { fontFamily: "Courier" }]}>{x.admissionNo}</Text>
              <Text style={[s.td, cell(3), { fontFamily: "Courier-Bold", letterSpacing: 0.8 }]}>{x.pin ?? "—"}</Text>
              <Text style={[s.td, cell(4)]} />
            </View>
          ))}
          <Text fixed style={{ position: "absolute", bottom: 18, left: 36, right: 36, fontSize: 7.5, color: "#4B5563", textAlign: "right" }} render={({ subPageNumber, subPageTotalPages }) => `${c.name} · page ${subPageNumber} of ${subPageTotalPages}`} />
        </Page>
      ))}
    </Document>
  );
}
