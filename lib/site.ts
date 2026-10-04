/** Public site details (marketing pages, footer, SEO). */
export const SITE = {
  name: "SonoCBT",
  tagline: "CBT and results for Nigerian secondary schools",
  description:
    "CBT software for schools in Nigeria: turn your Word exam papers into computer-based tests that survive bad network, mark them, build the broadsheet and print report cards with positions. Free 30-day trial.",
  email: "hello@sonocbt.ng",
  company: "Sono Technologies",
  city: "Lagos, Nigeria",
  /** International format without +, e.g. 2348012345678. Set NEXT_PUBLIC_SALES_WHATSAPP for "Book a demo". */
  whatsapp: process.env.NEXT_PUBLIC_SALES_WHATSAPP || "",
};

export function whatsappLink(text = "Hello SonoCBT, I'd like to book a demo for my school."): string | null {
  return SITE.whatsapp ? `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(text)}` : null;
}
