// Optional notification email on every form submission.
// If no SMTP env vars are set, this no-ops (and logs to the console instead),
// so the server still runs cleanly without any mail config.

import nodemailer from 'nodemailer';

const HOST    = process.env.SMTP_HOST;
const PORT    = parseInt(process.env.SMTP_PORT || '587', 10);
const USER    = process.env.SMTP_USER;
const PASS    = process.env.SMTP_PASS;
const FROM    = process.env.MAIL_FROM   || 'Legal Champions <noreply@legalchampions.my>';
const NOTIFY  = process.env.NOTIFY_EMAIL || 'engage@legalchampions.my';

let transporter = null;
if (HOST && USER && PASS) {
  transporter = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: PORT === 465,
    auth: { user: USER, pass: PASS }
  });
  console.log(`[mail] SMTP configured · notifications to ${NOTIFY}`);
} else {
  console.log('[mail] SMTP not configured — submissions will be logged but not emailed');
}

const LABELS = {
  waitlist: 'New waiting-list signup',
  brief:    'New brief submission',
  contact:  'New contact / chat enquiry'
};

function format(kind, row) {
  const lines = [];
  for (const [k, v] of Object.entries(row)) {
    if (k === 'ip' || k === 'user_agent') continue;
    if (v == null || v === '') continue;
    const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    lines.push(`${label}: ${v}`);
  }
  lines.push('', '— Captured by the Legal Champions site.');
  return lines.join('\n');
}

export async function sendNotification(kind, row) {
  const subject = `${LABELS[kind] || 'New submission'} — ${row.firm || row.email || row.contact_name || 'visitor'}`;
  const body    = format(kind, row);

  if (!transporter) {
    console.log(`[mail] (no SMTP) ${subject}\n${body}\n`);
    return;
  }

  await transporter.sendMail({
    from: FROM,
    to:   NOTIFY,
    subject,
    text: body,
    replyTo: row.email || undefined
  });
}
