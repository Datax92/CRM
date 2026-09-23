import type { Metadata } from "next";

/**
 * The public privacy policy Meta requires before the "CRM" app can be
 * published (owner, 2026-09-23) — publishing is what lets Meta send real
 * WhatsApp and lead-form webhooks rather than test ones.
 *
 * A server component with no auth: `GlobalLayout` renders children bare for a
 * signed-out visitor, and Meta's reviewer and crawler are exactly that. Inline
 * styles, because a public page has to render right with nothing else loaded.
 *
 * It describes what the CRM actually collects and nothing more — the lead-form
 * answers and the WhatsApp name, number and first message from an ad — so
 * update it if intake ever starts reading anything else.
 */

export const metadata: Metadata = {
  title: "Privacy Policy · Mahziyar Group CRM",
  description: "How Mahziyar Group handles the details you share through our Facebook, Instagram and WhatsApp ads.",
};

const UPDATED = "23 September 2026";

const h2: React.CSSProperties = { fontSize: 18, fontWeight: 700, color: "#2f7d78", margin: "28px 0 8px" };
const p: React.CSSProperties = { margin: "0 0 12px" };
const li: React.CSSProperties = { margin: "0 0 6px" };

export default function PrivacyPolicyPage() {
  return (
    <main style={{ minHeight: "100dvh", background: "#e9f1f0", padding: "32px 16px", fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <article
        style={{
          maxWidth: 760,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 18,
          padding: "32px clamp(18px, 5vw, 44px)",
          color: "#2b3a39",
          fontSize: 15,
          lineHeight: 1.65,
        }}
      >
        <h1 style={{ fontSize: 28, fontWeight: 800, color: "#2b3a39", margin: 0 }}>Privacy Policy</h1>
        <p style={{ ...p, color: "#7e918f", fontSize: 13 }}>Mahziyar Group · last updated {UPDATED}</p>

        <p style={p}>
          This policy explains how Mahziyar Group (&ldquo;we&rdquo;) handles the information you share with us when you
          respond to one of our advertisements on Facebook, Instagram or WhatsApp. Our customer-management system
          (&ldquo;the CRM&rdquo;) is used only by our own staff to reply to you about the property you asked about.
        </p>

        <h2 style={h2}>What we collect</h2>
        <ul style={{ paddingLeft: 20, margin: "0 0 12px" }}>
          <li style={li}>
            <strong>From a Facebook or Instagram lead form:</strong> the answers you submit — typically your name, phone
            number, email address and city, and any other questions on that form.
          </li>
          <li style={li}>
            <strong>From a WhatsApp message sent by tapping one of our ads:</strong> your WhatsApp name, your phone
            number, the first message you send, and which of our ads you tapped.
          </li>
          <li style={li}>
            <strong>What our staff record while helping you:</strong> notes of calls and meetings, and — only if you
            go ahead with a purchase — the details needed to complete it.
          </li>
        </ul>
        <p style={p}>
          We do not collect anything from WhatsApp messages that did not come from one of our ads, and we do not read
          your Facebook profile, friends or activity.
        </p>

        <h2 style={h2}>How we use it</h2>
        <p style={p}>
          Only to contact you about the property or service you enquired about, to arrange meetings or site visits,
          and to keep a record of our conversations with you. We do not sell your information, and we do not share it
          with anyone outside Mahziyar Group except the service providers that run the CRM for us, listed below.
        </p>

        <h2 style={h2}>Where it is kept</h2>
        <p style={p}>
          The CRM is hosted on Vercel and stores its data in Google Firebase (Google Cloud). Access is limited to our
          own staff, each with their own sign-in, and each staff member can see only the enquiries assigned to them or
          their team. Meta Platforms (Facebook, Instagram, WhatsApp) delivers your enquiry to us under its own privacy
          policy.
        </p>

        <h2 style={h2}>How long we keep it</h2>
        <p style={p}>
          For as long as we are in contact with you about an enquiry, and afterwards as long as we need it for our
          business records, unless you ask us to delete it sooner.
        </p>

        <h2 id="deletion" style={h2}>Deleting your information</h2>
        <p style={p}>
          You can ask us at any time to delete the information we hold about you. Send a WhatsApp message to{" "}
          <strong>+92 311 1555426</strong> or a message to the <strong>Mahziyar Marketing</strong> Facebook Page saying
          &ldquo;Delete my data&rdquo;, from the phone number or account you contacted us with. We will remove your
          details from the CRM within 30 days and confirm when it is done.
        </p>

        <h2 style={h2}>Contact</h2>
        <p style={{ ...p, marginBottom: 0 }}>
          Questions about this policy can be sent to the same WhatsApp number or Facebook Page.
        </p>
      </article>
    </main>
  );
}
