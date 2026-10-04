import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin, username } from "better-auth/plugins";
import type { Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";

export function createAuth(db: Db) {
  return betterAuth({
    appName: "SonoCBT",
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    advanced: { database: { generateId: "uuid" } },
    emailAndPassword: {
      enabled: true,
      // Staff are invited by an admin; students are created by the school.
      disableSignUp: true,
      minPasswordLength: 8,
      sendResetPassword: async ({ user, url }) => {
        // Students have placeholder addresses; their form teacher resets them instead.
        if (user.email.endsWith(".invalid")) return;
        // The public demo school never sends email.
        const schoolId = (user as { schoolId?: string | null }).schoolId;
        if (schoolId) {
          const [s] = await db.select({ isDemo: schema.school.isDemo }).from(schema.school).where(eq(schema.school.id, schoolId));
          if (s?.isDemo) return;
        }
        await sendEmail({
          to: user.email,
          subject: "Reset your SonoCBT password",
          text: `Use this link to choose a new password:\n\n${url}\n\nIf you didn't ask for this, you can ignore this email.`,
        });
      },
    },
    user: {
      additionalFields: {
        schoolId: { type: "string", required: false, input: false },
        mustChangePassword: { type: "boolean", required: false, defaultValue: false, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 12, // a school day
      updateAge: 60 * 60,
      // Saves a database round trip per request; a revoked session lingers at most a minute.
      cookieCache: { enabled: true, maxAge: 60 },
    },
    plugins: [
      username({
        // "<schoolId>|<admission no>" — see lib/auth/student-username.ts
        minUsernameLength: 3,
        maxUsernameLength: 120,
        usernameValidator: (u) => /^[a-z0-9-]+\|[a-z0-9/._-]+$/i.test(u),
      }),
      // Support sign-in for platform owners only: they alone have user.role "admin".
      // An impersonated session lasts an hour and is audited (lib/platform).
      admin({
        adminRoles: ["admin"],
        defaultRole: "user",
        impersonationSessionDuration: 60 * 60,
        // Graduated and departed students' accounts are closed this way (lib/students/moves.ts).
        bannedUserMessage: "This account is closed: the student has graduated or left the school. Parents can still check results with a PIN.",
      }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
