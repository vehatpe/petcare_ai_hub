'use strict';
const { T } = require('./db');

module.exports = (db) => ({
  async log({ actorUserId, action, targetType, targetId, detail }) {
    await db.query(
      `INSERT INTO dbo.AuditLog (ActorUserId, Action, TargetType, TargetId, Detail)
       VALUES (@actorUserId, @action, @targetType, @targetId, @detail)`,
      {
        actorUserId: [T.guid, actorUserId || null],
        action: [T.vstr(40), action],
        targetType: [T.vstr(20), targetType],
        targetId: [T.vstr(50), String(targetId)],
        detail: [T.str(500), detail || null]
      }
    );
  }
});
