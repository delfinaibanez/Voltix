const { Router } = require('express');
const config = require('../config/env');

const router = Router();

// Healthcheck simple: no expone secretos ni información sensible.
router.get('/', (req, res) => {
  res.json({ service: config.serviceName, status: 'ok' });
});

module.exports = router;