const { main } = require('./src/bot');

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
