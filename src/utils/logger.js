const chalk = require('chalk');

function timestamp() {
  const now = new Date();
  return chalk.gray(`[${now.toLocaleTimeString()}]`);
}

const logger = {
  info: (msg, ...args) => console.log(`${timestamp()} ${chalk.blue('ℹ')} ${msg}`, ...args),
  success: (msg, ...args) => console.log(`${timestamp()} ${chalk.green('✔')} ${chalk.green(msg)}`, ...args),
  warn: (msg, ...args) => console.log(`${timestamp()} ${chalk.yellow('⚠')} ${chalk.yellow(msg)}`, ...args),
  error: (msg, ...args) => console.log(`${timestamp()} ${chalk.red('✖')} ${chalk.red(msg)}`, ...args),
  step: (msg, ...args) => console.log(`${timestamp()} ${chalk.cyan('➜')} ${chalk.bold(msg)}`, ...args),
  divider: () => console.log(chalk.gray('─'.repeat(70))),
  header: (title) => {
    console.log('\n' + chalk.bold.cyan('='.repeat(70)));
    console.log(chalk.bold.cyan(`   ${title}`));
    console.log(chalk.bold.cyan('='.repeat(70)) + '\n');
  },
};

module.exports = logger;
