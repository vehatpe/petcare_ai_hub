'use strict';
/**
 * Reads docs/knowledge-base/*.md, splits into ~800-char chunks, embeds with Gemini and
 * replaces the rows of each document (by DocSlug) in Knowledge_Chunks.
 *   node scripts/ingest-knowledge.js            # real run (needs DB + GEMINI_API_KEY)
 *   node scripts/ingest-knowledge.js --dry-run  # only parse + chunk, no DB, no network
 */
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { parseFrontmatter, splitMarkdown } = require('../src/utils/chunker');

const KB_DIR = path.resolve(__dirname, '../../docs/knowledge-base');
const REVIEW = ['pending-veterinary-review', 'approved', 'rejected'];

function loadDocs() {
  return fs.readdirSync(KB_DIR).filter((f) => f.endsWith('.md')).sort().map((file) => {
    const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(KB_DIR, file), 'utf8'));
    if (!meta.title) throw new Error(`${file}: thiếu "title" trong frontmatter`);
    const reviewStatus = meta.reviewStatus || 'pending-veterinary-review';
    if (!REVIEW.includes(reviewStatus)) throw new Error(`${file}: reviewStatus không hợp lệ (${reviewStatus})`);
    const chunks = splitMarkdown(body, 800);
    return { slug: path.basename(file, '.md'), title: meta.title, reviewStatus, chunks };
  });
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const docs = loadDocs();
  if (dry) {
    for (const d of docs) console.log(`${d.slug}: "${d.title}" [${d.reviewStatus}] -> ${d.chunks.length} chunk(s), max ${Math.max(...d.chunks.map((c) => c.length))} ký tự`);
    console.log(`Dry run xong: ${docs.length} tài liệu, ${docs.reduce((n, d) => n + d.chunks.length, 0)} chunk. Chưa gọi Gemini, chưa ghi DB.`);
    return;
  }
  const config = loadConfig();
  if (!config.gemini.apiKey) throw new Error('Thiếu GEMINI_API_KEY.');
  const { createSqlModels } = require('../src/models');
  const { createGeminiClient } = require('../src/services/gemini-client');
  const ai = createGeminiClient(config.gemini);
  const { models, pool } = await createSqlModels(config.db);
  try {
    for (const d of docs) {
      const rows = [];
      for (let i = 0; i < d.chunks.length; i++) {
        rows.push({ chunkIndex: i, content: d.chunks[i], embedding: await ai.embed(d.chunks[i], 'RETRIEVAL_DOCUMENT') });
      }
      await models.knowledge.replaceDoc({ docSlug: d.slug, docTitle: d.title, reviewStatus: d.reviewStatus }, rows);
      console.log(`Đã nạp ${d.slug}: ${rows.length} chunk`);
    }
  } finally {
    await pool.close();
  }
}

main().catch((e) => { console.error('Ingest lỗi:', e.message); process.exit(1); });
