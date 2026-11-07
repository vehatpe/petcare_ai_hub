'use strict';
const { wrap, ok } = require('../utils/http');

module.exports = ({ aiRagService }) => ({
  chat: wrap(async (req, res) => ok(res, await aiRagService.chat(req.user.id, req.body || {})))
});
