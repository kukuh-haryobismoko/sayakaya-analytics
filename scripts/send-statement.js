'use strict';

// One-off manual send: generates one user's portfolio PDF and emails it to
// them, for proving the SMTP + PDF path end to end before any batch/scheduler
// work gets built on top of it.
//
// Usage: node scripts/send-statement.js <userId>

require('dotenv').config();
const { runQuery } = require('../server/bigquery');
const Q = require('../server/queries');
const PDF = require('../server/pdf');
const { sendStatementEmail } = require('../server/mail');

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error('Usage: node scripts/send-statement.js <userId>');
    process.exit(1);
  }

  const c = Q.userContact(userId);
  const h = Q.userHoldings(userId);
  const [contactRows, holdings] = await Promise.all([
    runQuery(c.sql, c.params, { redact: false }),
    runQuery(h.sql, h.params),
  ]);
  const contact = contactRows[0];
  if (!contact?.email) throw new Error(`No email on file for user ${userId}`);

  const buf = await PDF.portfolioReport({ contact, holdings }, [], { username: 'system' });

  await sendStatementEmail({
    to: contact.email,
    name: contact.name,
    attachments: [{ filename: `Portfolio_${contact.sid || userId}.pdf`, content: buf }],
  });
  console.log(`Sent statement to ${contact.email}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
