import log, { LogLevelDesc } from 'loglevel';

const logger = log.getLogger('collaboration-client');

if (typeof process !== 'undefined') {
  if (process.env.LOG) {
    logger.setLevel(process.env.LOG as LogLevelDesc);
  } else if (process.env.NODE_ENV === 'test') {
    logger.setLevel('silent');
  } else if (process.env.NODE_ENV === 'development') {
    logger.setLevel('debug');
  } else {
    logger.setLevel('warn');
  }
}

export default logger;
