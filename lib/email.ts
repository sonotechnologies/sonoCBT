type Email = { to: string; subject: string; text: string };

/** "SonoCBT <you@gmail.com>" → { name, email } */
export function parseSender(from: string): { name: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1] || "SonoCBT", email: m[2] } : { name: "SonoCBT", email: from.trim() };
}

/**
 * Sends a transactional email.
 * - BREVO_API_KEY set → Brevo (free tier; the sender in EMAIL_FROM must be a verified Brevo sender)
 * - RESEND_API_KEY set → Resend (needs a verified domain)
 * - neither → logged to the server console (local development)
 */
export async function sendEmail({ to, subject, text }: Email): Promise<void> {
  const from = process.env.EMAIL_FROM ?? "SonoCBT <noreply@sonocbt.com>";

  if (process.env.BREVO_API_KEY) {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sender: parseSender(from), to: [{ email: to }], subject, textContent: text }),
    });
    if (!res.ok) throw new Error(`Brevo failed: ${res.status} ${await res.text()}`);
    return;
  }

  if (process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!res.ok) throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
    return;
  }

  console.info(`[email:dev] to=${to} subject=${subject}\n${text}`);
}
