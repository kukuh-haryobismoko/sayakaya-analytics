'use strict';

const nodemailer = require('nodemailer');
const LOGO_BUFFER = Buffer.from(require('./logo-horizontal'), 'base64');
const LOGO_CID = 'sayakaya-horizontal-logo';

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465, // 587 = STARTTLS, 465 = implicit TLS
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// Fallback text used only when a caller doesn't pass its own subject/body —
// the "Send statement" tab's compose modal always sends edited text
// (public/app.js: defaultStatementEmail), so this mainly covers scripts.
function defaultSubject() {
  return `Your Sayakaya Statement — ${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}`;
}
// Shared with public/app.js's defaultStatementEmail (the text an admin
// actually edits/sends) — kept in sync by hand since one runs in the browser.
const PDF_PASSWORD_NOTE = 'To open the attached PDF file(s), use your date of birth as registered with us in DDMMYYYY format (e.g. 17081990 for 17 August 1990).';
function defaultBody({ name }) {
  return `Dear ${name || 'Investor'},\n\nPlease find your requested statement(s) attached, issued by PT Sayakaya Lahir Batin.\n\n${PDF_PASSWORD_NOTE}\n\nIf any details appear incorrect, please contact our support team.\n\nBest regards,\nPT Sayakaya Lahir Batin`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Same disclosures as the PDF statements themselves (server/pdf.js:
// DISCLAIMER/OJK_LINE), in English, plus the licensing line every regulated
// APERD email should carry — mirrors the moomoo statement-email layout this
// was modeled after (logo header, body, regulatory footer).
const FOOTER_HTML = `
  <p style="margin:0 0 10px">Mutual fund distribution services are offered through PT Sayakaya Lahir Batin, a Mutual Fund Selling Agent (Agen Penjual Efek Reksa Dana / APERD) registered with and supervised by the Financial Services Authority of Indonesia (Otoritas Jasa Keuangan / OJK), registration number KEP-17/PM.21/2021.</p>
  <p style="margin:0 0 10px">Investments in mutual funds carry risk, including possible loss of principal. Net Asset Value (NAV) may fluctuate, and past performance is not indicative of future results. No content in this email or its attachments constitutes investment advice, a recommendation, or a solicitation to buy or sell any security.</p>
  <p style="margin:0 0 10px">This statement is prepared by PT Sayakaya Lahir Batin for the named investor's use only and is not a substitute for the official report issued by the Custodian Bank; in the event of any discrepancy, the Custodian Bank's report shall prevail. This document is system-generated and does not require a signature.</p>
  <p style="margin:0">Questions about this statement? Contact us at <a href="mailto:hi@sayakaya.id" style="color:#1e2a4a">hi@sayakaya.id</a>.</p>
`;

function htmlEmail(body) {
  const bodyHtml = escapeHtml(body).replace(/\n/g, '<br>');
  return `
<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1d2e">
  <div style="padding:24px 0 16px"><img src="cid:${LOGO_CID}" alt="Sayakaya" width="180" style="display:block"></div>
  <div style="font-size:14px;line-height:1.6">${bodyHtml}</div>
  <hr style="margin:28px 0;border:none;border-top:1px solid #e7e4dc">
  <div style="font-size:11px;line-height:1.6;color:#6b7280">${FOOTER_HTML}</div>
</div>`;
}

// attachments: [{ filename, content: Buffer }, ...] — one or more PDFs.
// from: overrides the default sender (server/app.js picks a different
// verified SES identity for Send statement vs. Send fund performance).
async function sendStatementEmail({ to, subject, body, name, attachments, from }) {
  const text = body || defaultBody({ name });
  await transport.sendMail({
    from: from || process.env.SMTP_FROM,
    to,
    subject: subject || defaultSubject(),
    text,
    html: htmlEmail(text),
    attachments: [
      ...attachments,
      { filename: 'sayakaya-horizontal.png', content: LOGO_BUFFER, cid: LOGO_CID, contentDisposition: 'inline' },
    ],
  });
}

// Dashboard-staff email (not investor-facing) — skips the APERD/regulatory
// footer used on statement emails, since that disclosure doesn't apply here.
async function sendPasswordResetEmail({ to, username, resetUrl }) {
  const text = `Hi ${username},\n\nWe received a request to reset your Sayakaya Analytics password.\n\nReset your password: ${resetUrl}\n\nThis link expires in 30 minutes and can only be used once. If you didn't request this, you can safely ignore this email — your password won't change.`;
  const html = `
<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1d2e">
  <div style="padding:24px 0 16px"><img src="cid:${LOGO_CID}" alt="Sayakaya" width="180" style="display:block"></div>
  <div style="font-size:14px;line-height:1.6">
    <p>Hi ${escapeHtml(username)},</p>
    <p>We received a request to reset your Sayakaya Analytics password.</p>
    <p><a href="${resetUrl}" style="display:inline-block;background:#3a50ab;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Reset password</a></p>
    <p style="color:#6b7280;font-size:12px">This link expires in 30 minutes and can only be used once. If you didn't request this, you can safely ignore this email — your password won't change.</p>
  </div>
</div>`;
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: 'Reset your Sayakaya Analytics password',
    text,
    html,
    attachments: [{ filename: 'sayakaya-horizontal.png', content: LOGO_BUFFER, cid: LOGO_CID, contentDisposition: 'inline' }],
  });
}

module.exports = { sendStatementEmail, sendPasswordResetEmail };
