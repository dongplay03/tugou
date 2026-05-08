"use strict";
const { runCollector } = require('./collector');

(async () => {
  try {
    const file = await runCollector();
    console.log('aveai-collector: metrics saved to', file);
  } catch (err) {
    console.error('aveai-collector error:', err);
    process.exit(1);
  }
})();
