import winston from 'winston';
import path from 'path';

const logLevel = process.env.LOG_LEVEL || 'info';

// Use absolute paths to ensure logs go to THIS project's directory
const logsDir = path.resolve(__dirname, '../../logs');

export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'hermes-backend' },
  transports: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log') 
    }),
  ],
});

// Console logging for development with filtering
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format((info) => {
          // Only log if it's specifically from hermes-backend
          if (info.service === 'hermes-backend') {
            return info;
          }
          return false;
        })(),
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
          return `[HERMES] ${timestamp} ${level}: ${message}`;
        })
      ),
    })
  );
}

export default logger;
