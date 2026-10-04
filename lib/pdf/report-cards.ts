import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import JSZip from "jszip";
import { createElement } from "react";
import type { ReportCard } from "@/lib/results/report-card";
import { appUrl, loadImage, qrDataUrl } from "./assets";
import { ReportCardsDocument, type CardAssets } from "./report-card-doc";

async function assetsFor(card: ReportCard): Promise<CardAssets> {
  const base = appUrl();
  const [logo, photo, signature, qr] = await Promise.all([
    loadImage(card.school.logoUrl),
    loadImage(card.student.photoUrl),
    loadImage(card.school.principalSignatureUrl),
    card.verifyCode ? qrDataUrl(`${base}/verify/${card.verifyCode}`) : Promise.resolve(null),
  ]);
  return { logo, photo, signature, qr, verifyHost: base.replace(/^https?:\/\//, "") };
}

/** One PDF with a page per card. */
export async function reportCardsPdf(cards: ReportCard[], title: string): Promise<Buffer> {
  const pages = await Promise.all(cards.map(async (card) => ({ card, assets: await assetsFor(card) })));
  return renderToBuffer(createElement(ReportCardsDocument, { pages, title }) as Parameters<typeof renderToBuffer>[0]);
}

/** "GFA-2021-0147 Chiamaka Okafor.pdf" */
export function cardFileName(card: ReportCard, ext = "pdf"): string {
  return `${card.student.admissionNo.replace(/[^A-Za-z0-9]+/g, "-")} ${card.student.name.replace(/[^\p{L}\p{N} .'-]+/gu, "")}.${ext}`;
}

/** A zip with one PDF per student. */
export async function reportCardsZip(cards: ReportCard[], termLabel: string): Promise<Buffer> {
  const zip = new JSZip();
  for (const card of cards) zip.file(cardFileName(card), await reportCardsPdf([card], `${card.student.name} · ${termLabel}`));
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

/** Content-Disposition with a safe ASCII fallback and the UTF-8 name. */
export function attachment(filename: string, inline = false): string {
  const ascii = filename.replace(/[^\x20-\x7E]+/g, "").replace(/"/g, "");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
