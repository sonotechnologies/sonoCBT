/** Result-checker PIN cards, 10 to an A4 page (2 × 5), with cut lines. */
import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

export type PinCard = { serial: string; pin: string; maxUses: number };

// Never split words (URLs, names, codes) across lines with a hyphen.
Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  page: { padding: 22, fontFamily: "Helvetica", fontSize: 8, color: "#111827", flexDirection: "row", flexWrap: "wrap" },
  // A4 is 595 × 842 pt; 22 pt margins leave 551 × 798 for 2 × 5 cards.
  card: { width: 275, height: 159, padding: 12, borderWidth: 0.6, borderStyle: "dashed", borderColor: "#9CA3AF", justifyContent: "space-between" },
});

export function PinSheetDocument({ school, termLabel, url, pins, brand }: { school: string; termLabel: string; url: string; pins: PinCard[]; brand: string }) {
  const pages: PinCard[][] = [];
  for (let i = 0; i < pins.length; i += 10) pages.push(pins.slice(i, i + 10));
  return (
    <Document title={`${school} result PINs · ${termLabel}`} author="SonoCBT" creator="SonoCBT" producer="SonoCBT">
      {pages.map((group, p) => (
        <Page key={p} size="A4" style={s.page}>
          {group.map((c) => (
            <View key={c.serial} style={s.card} wrap={false}>
              <View>
                <Text style={{ fontSize: 10.5, fontFamily: "Helvetica-Bold", color: brand }}>{school}</Text>
                <Text style={{ fontSize: 7.5, marginTop: 2, color: "#4B5563" }}>RESULT CHECKER PIN · {termLabel.toUpperCase()}</Text>
              </View>
              <View style={{ borderWidth: 1, borderColor: "#111827", borderRadius: 4, paddingVertical: 6, alignItems: "center" }}>
                <Text style={{ fontFamily: "Courier-Bold", fontSize: 17, letterSpacing: 1 }}>{c.pin}</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 7.5 }}>Check at {url}</Text>
                  <Text style={{ fontSize: 7, color: "#4B5563", marginTop: 1.5 }}>
                    Works {c.maxUses} {c.maxUses === 1 ? "time" : "times"}, for one student and this term only.
                  </Text>
                </View>
                <Text style={{ fontFamily: "Courier", fontSize: 7.5 }}>{c.serial}</Text>
              </View>
            </View>
          ))}
        </Page>
      ))}
    </Document>
  );
}
