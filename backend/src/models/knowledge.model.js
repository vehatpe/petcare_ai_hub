'use strict';
const { T } = require('./db');

module.exports = (db) => ({
  async listChunks() {
    const rows = await db.query(
      `SELECT ChunkId, DocSlug, DocTitle, ChunkIndex, Content, EmbeddingJson, ReviewStatus FROM dbo.Knowledge_Chunks ORDER BY DocSlug, ChunkIndex`);
    const out = [];
    for (const r of rows) {
      let embedding;
      try { embedding = JSON.parse(r.EmbeddingJson); } catch (_) { continue; }
      if (!Array.isArray(embedding)) continue;
      out.push({ chunkId: r.ChunkId, docSlug: r.DocSlug, docTitle: r.DocTitle, chunkIndex: r.ChunkIndex, content: r.Content, embedding, reviewStatus: r.ReviewStatus });
    }
    return out;
  },
  /** Replace all chunks of one document atomically. chunks: [{chunkIndex, content, embedding}] */
  async replaceDoc({ docSlug, docTitle, reviewStatus }, chunks) {
    await db.transaction(async (tx) => {
      await tx.query(`DELETE FROM dbo.Knowledge_Chunks WHERE DocSlug = @slug`, { slug: [T.vstr(100), docSlug] });
      for (const c of chunks) {
        await tx.query(
          `INSERT INTO dbo.Knowledge_Chunks (DocSlug, DocTitle, ChunkIndex, Content, EmbeddingJson, ReviewStatus)
           VALUES (@slug, @title, @idx, @content, @emb, @review)`,
          {
            slug: [T.vstr(100), docSlug], title: [T.str(200), docTitle], idx: [T.int, c.chunkIndex], content: [T.max, c.content],
            emb: [T.max, JSON.stringify(c.embedding)], review: [T.vstr(30), reviewStatus]
          });
      }
    });
  }
});
