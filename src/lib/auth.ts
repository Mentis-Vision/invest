import { betterAuth } from "better-auth";
import { Pool } from "@neondatabase/serverless";
import { sendEmail, renderEmailTemplate } from "./email";

const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";

// Email verification is opt-in via REQUIRE_EMAIL_VERIFICATION=true. We default
// to OFF so production deploys don't lock users out when Resend isn't yet
// configured. Turn on once RESEND_API_KEY is set and tested.
const requireEmailVerification = process.env.REQUIRE_EMAIL_VERIFICATION === "true";

export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
  }),
  appName: "ClearPath Invest",
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    requireEmailVerification,
    async sendResetPassword({ user, url }) {
      await sendEmail({
        to: user.email,
        subject: "Reset your ClearPath password",
        html: renderEmailTemplate({
          preview: "Someone asked to reset your password",
          body: `
            <p>Hi ${escapeHtml(user.name || "there")},</p>
            <p>We received a request to reset the password for your ClearPath
            Invest account. If this was you, click the button below to choose
            a new password. The link expires in one hour.</p>
            <p>If you didn&rsquo;t request this, you can safely ignore this email —
            your password will stay the same.</p>
          `,
          ctaLabel: "Reset password",
          ctaUrl: url,
          footnote: `For security, this email was sent to ${escapeHtml(user.email)}. Never share this link.`,
        }),
        text: `Reset your ClearPath password:\n\n${url}\n\nIf you didn't request this, ignore this email.`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: requireEmailVerification,
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user, url }) {
      await sendEmail({
        to: user.email,
        subject: "Verify your ClearPath email",
        html: renderEmailTemplate({
          preview: "Confirm your email to start using ClearPath Invest",
          body: `
            <p>Welcome to ClearPath Invest, ${escapeHtml(user.name || "investor")}.</p>
            <p>Confirm this is your email address to finish creating your account.</p>
          `,
          ctaLabel: "Verify email",
          ctaUrl: url,
          footnote: `If you didn&rsquo;t sign up, you can ignore this email. The link expires in 24 hours.`,
        }),
        text: `Verify your ClearPath email: ${url}`,
      });
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  trustedOrigins: [baseUrl],
});

export type Auth = typeof auth;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
