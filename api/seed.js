// One-shot seed for the proof-of-concept portals.
//
// Idempotent: only runs if the users table is empty. Creates one demo firm,
// one demo firm user, a small founding cohort of paralegals, and a couple
// of live matters so the dashboards show real data.
//
// Demo credentials (printed at startup so the user can sign in):
//   FIRM       aishah@tanpartners.my       password: champion
//   PARALEGAL  priya@legalchampions.my     password: champion

import { db } from './db.js';
import { hashPassword } from './auth.js';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'champion';

export function seedIfEmpty() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (count > 0) return { seeded: false, count };

  const pwHash = hashPassword(DEMO_PASSWORD);

  const tx = db.transaction(() => {
    // ----- firms -----
    const firmId = db.prepare(`INSERT INTO firms (name) VALUES (?)`)
      .run('Tan & Partners').lastInsertRowid;

    // ----- firm user -----
    const firmUserId = db.prepare(`
      INSERT INTO users (email, password_hash, role, name, firm_id)
      VALUES (?, ?, 'firm', ?, ?)
    `).run('aishah@tanpartners.my', pwHash, 'Aishah Kamarudin', firmId).lastInsertRowid;

    // ----- founding cohort of paralegals -----
    const paralegals = [
      { email: 'priya@legalchampions.my',  name: 'Priya Shah',     rate: 200, avail: 'available',
        specialisms: 'Civil litigation, court bundles, research',
        bio: 'Six years of litigation support across dispute resolution practices in KL.' },
      { email: 'marcus@legalchampions.my', name: 'Marcus Boateng', rate: 220, avail: 'limited',
        specialisms: 'M&A due diligence, data-room review, closings',
        bio: 'Five years of transactional support across mid-market M&A.' },
      { email: 'hannah@legalchampions.my', name: 'Hannah Lim',     rate: 200, avail: 'available',
        specialisms: 'Conveyancing, SPA drafting, land registration',
        bio: 'Four years of conveyancing and real-estate support.' },
      { email: 'jay@legalchampions.my',    name: 'Jay Patel',      rate: 240, avail: 'capacity',
        specialisms: 'Contract drafting, comparative redlines, SPAs & NDAs',
        bio: 'Eight years of commercial drafting and review. Quietly the person we hand precedent libraries to.' },
      { email: 'sofia@legalchampions.my',  name: 'Sofia Reyes',    rate: 200, avail: 'available',
        specialisms: 'Legal research, statutory analysis, comparative jurisdictions',
        bio: 'LLM with academic research background.' },
      { email: 'tom@legalchampions.my',    name: "Tom O'Brien",    rate: 200, avail: 'limited',
        specialisms: 'Pleadings, written submissions, witness statements',
        bio: 'Five years of commercial litigation support.' }
    ];

    const insertPara = db.prepare(`
      INSERT INTO users (email, password_hash, role, name, bio, hourly_rate, specialisms, availability)
      VALUES (?, ?, 'paralegal', ?, ?, ?, ?, ?)
    `);
    const paraIds = {};
    for (const p of paralegals) {
      paraIds[p.name] = insertPara.run(p.email, pwHash, p.name, p.bio, p.rate, p.specialisms, p.avail).lastInsertRowid;
    }

    // ----- demo matters -----
    const insertMatter = db.prepare(`
      INSERT INTO matters
        (title, description, firm_id, paralegal_id, created_by, practice_area, status, estimated_hours, deadline)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const m1 = insertMatter.run(
      'Court bundle — IP Holdings v Mahkota Mall',
      'Indexed bundle for filing. Approx 800 pages across four volumes.',
      firmId, paraIds['Priya Shah'], firmUserId, 'Litigation', 'in-progress', 12, '2026-05-30'
    ).lastInsertRowid;

    const m2 = insertMatter.run(
      'SPA review — Acquisition of NewCo Sdn Bhd',
      'Review and redline of share purchase agreement, with comparison to precedent.',
      firmId, paraIds['Jay Patel'], firmUserId, 'Corporate', 'in-review', 10, '2026-05-28'
    ).lastInsertRowid;

    const m3 = insertMatter.run(
      'NDA precedent refresh — 12 templates',
      'Refresh and harmonise the firm\'s NDA precedent library.',
      firmId, paraIds['Marcus Boateng'], firmUserId, 'Commercial', 'delivered', 8, '2026-05-07'
    ).lastInsertRowid;

    // ----- demo time entries (so paralegal dashboard shows real hours) -----
    const insertTime = db.prepare(`
      INSERT INTO time_entries (matter_id, paralegal_id, entry_date, hours, description, billable)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    const today = new Date().toISOString().slice(0, 10);
    const daysAgo = n => new Date(Date.now() - n * 86400 * 1000).toISOString().slice(0, 10);

    insertTime.run(m1, paraIds['Priya Shah'], today,       2.0, 'Court bundle indexing — IP Holdings v Mahkota');
    insertTime.run(m1, paraIds['Priya Shah'], today,       1.5, 'Witness chronology revisions');
    insertTime.run(m1, paraIds['Priya Shah'], daysAgo(1),  7.5, 'Bundle assembly and cross-references');
    insertTime.run(m1, paraIds['Priya Shah'], daysAgo(2),  7.0, 'Document review and indexing');
    insertTime.run(m1, paraIds['Priya Shah'], daysAgo(3),  6.5, 'Initial bundle scoping with senior counsel');
    insertTime.run(m2, paraIds['Jay Patel'],  daysAgo(1),  3.0, 'SPA redline against precedent library');
    insertTime.run(m3, paraIds['Marcus Boateng'], daysAgo(7), 6.5, 'NDA precedent refresh — final pass');
  });

  tx();

  return { seeded: true };
}
