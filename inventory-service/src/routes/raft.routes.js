const config = require('../config/env');
const raft = require('../raft');
const { createRaftRouter } = require('../raft/router');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');

module.exports = createRaftRouter({
  getNode: raft.getNode,
  token: config.raft.token,
  authenticate,
  authorize,
});