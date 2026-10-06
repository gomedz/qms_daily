const chalk = require('chalk');
const logger = require('../utils/logger');
const { sleep } = require('../utils/helpers');

/**
 * Calculates the next randomized run time within the specified UTC hour window.
 * @param {number} startHourUtc (e.g. 1)
 * @param {number} endHourUtc (e.g. 5)
 * @returns {{ targetDate: Date, msUntilRun: number }}
 */
function calculateNextRunTime(startHourUtc = 1, endHourUtc = 5) {
  const now = new Date();

  const minHour = Math.min(startHourUtc, endHourUtc);
  const maxHour = Math.max(startHourUtc, endHourUtc);

  // Random hour in [minHour, maxHour - 1] (or maxHour if minHour === maxHour)
  const hourSpan = maxHour > minHour ? maxHour - minHour : 1;
  const randomHour = minHour + Math.floor(Math.random() * hourSpan);
  const randomMinute = Math.floor(Math.random() * 60);
  const randomSecond = Math.floor(Math.random() * 60);

  // Construct target date in UTC
  const target = new Date(now);
  target.setUTCHours(randomHour, randomMinute, randomSecond, 0);

  // If already past for today, schedule for tomorrow
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  const msUntilRun = target.getTime() - now.getTime();
  return { targetDate: target, msUntilRun };
}

/**
 * Formats duration in milliseconds to human readable string (e.g. "4h 23m 12s")
 */
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(' ');
}

/**
 * Starts the daily scheduler daemon
 * @param {Function} taskCallback async function to run on each schedule trigger
 * @param {Object} options { startHourUtc, endHourUtc, runImmediately }
 */
async function startDailyScheduler(taskCallback, options = {}) {
  const startHour = options.startHourUtc ?? 1;
  const endHour = options.endHourUtc ?? 5;
  const runImmediately = options.runImmediately ?? false;

  logger.header('DAILY RANDOM SCHEDULER ACTIVATED');
  console.log(chalk.cyan(`  Execution Window:  `) + chalk.white.bold(`${startHour}:00 - ${endHour}:00 UTC`));
  console.log(chalk.cyan(`  Current UTC Time:  `) + chalk.yellow(`${new Date().toUTCString()}`));
  console.log(chalk.cyan(`  Current Local Time:`) + chalk.yellow(` ${new Date().toLocaleString()}\n`));

  if (runImmediately) {
    logger.info('Option RUN_IMMEDIATELY_ON_START is true. Running initial cycle now...');
    try {
      await taskCallback();
    } catch (err) {
      logger.error(`Initial scheduled task error: ${err.message}`);
    }
  }

  while (true) {
    const { targetDate, msUntilRun } = calculateNextRunTime(startHour, endHour);

    logger.divider();
    logger.info(chalk.bold.green(`Next scheduled execution calculated:`));
    console.log(chalk.cyan(`  Target UTC Time:   `) + chalk.white.bold(targetDate.toUTCString()));
    console.log(chalk.cyan(`  Target Local Time: `) + chalk.white.bold(targetDate.toLocaleString()));
    console.log(chalk.cyan(`  Countdown / Wait:  `) + chalk.yellow.bold(formatDuration(msUntilRun)));
    logger.divider();

    // Sleep until scheduled execution time
    await sleep(msUntilRun);

    logger.header(`WAKING UP FOR SCHEDULED DAILY RUN (${new Date().toUTCString()})`);
    try {
      await taskCallback();
      logger.success('Daily scheduled task completed successfully!');
    } catch (err) {
      logger.error(`Error during scheduled daily run: ${err.message}`);
    }

    // Wait a brief 60 seconds before calculating the next day's schedule to prevent duplicate triggers
    await sleep(60000);
  }
}

module.exports = {
  calculateNextRunTime,
  formatDuration,
  startDailyScheduler,
};
