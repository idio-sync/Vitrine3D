/**
 * Logger Module
 *
 * Centralized logging system with configurable log levels.
 * Extracted into its own module with zero external dependencies
 * so that consumers (e.g. archive-loader, archive-creator) can
 * be tested in Node.js without pulling in Three.js.
 *
 * Usage:
 *   import { Logger } from './logger.js';
 *   const log = Logger.getLogger('ModuleName');
 *   log.info('Hello');
 */

// =============================================================================
// LOGGING SYSTEM
// =============================================================================

/**
 * Log levels in order of verbosity (lower = more verbose)
 */
const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4
} as const;

type LogLevelValue = typeof LogLevel[keyof typeof LogLevel];

/**
 * Logger instance interface returned by getLogger()
 */
export interface LoggerInstance {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    group: (label: string, fn: () => void) => void;
    time: (label: string) => void;
    timeEnd: (label: string) => void;
}

/**
 * Centralized logging system with configurable log levels.
 *
 * Features:
 * - Configurable log levels (DEBUG, INFO, WARN, ERROR, NONE)
 * - Module prefixes for easy filtering
 * - URL parameter override (?log=debug)
 * - Production-friendly defaults (WARN level)
 * - Timestamp support for debugging
 *
 * Usage:
 *   const log = Logger.getLogger('ModuleName');
 *   log.debug('Detailed info for debugging');
 *   log.info('General information');
 *   log.warn('Warning message');
 *   log.error('Error message', errorObject);
 */
class Logger {
    static _level: LogLevelValue = LogLevel.WARN; // Default to WARN for production
    static _showTimestamps: boolean = false;
    static _initialized: boolean = false;
    static _loggers: Map<string, LoggerInstance> = new Map();

    /**
     * Initialize the logging system.
     * Checks URL parameters and sets appropriate log level.
     */
    static init(): void {
        if (Logger._initialized) return;

        // Check URL parameter for log level override
        const params = new URLSearchParams(window.location.search);
        const logParam = params.get('log')?.toLowerCase();

        if (logParam) {
            switch (logParam) {
                case 'debug':
                case 'all':
                    Logger._level = LogLevel.DEBUG;
                    Logger._showTimestamps = true;
                    break;
                case 'info':
                    Logger._level = LogLevel.INFO;
                    break;
                case 'warn':
                    Logger._level = LogLevel.WARN;
                    break;
                case 'error':
                    Logger._level = LogLevel.ERROR;
                    break;
                case 'none':
                case 'off':
                    Logger._level = LogLevel.NONE;
                    break;
            }
        }

        // Check if we're in development (localhost or file://)
        const isDev = window.location.hostname === 'localhost' ||
                      window.location.hostname === '127.0.0.1' ||
                      window.location.protocol === 'file:';

        // In development without explicit setting, default to INFO
        if (!logParam && isDev) {
            Logger._level = LogLevel.INFO;
        }

        Logger._initialized = true;

        // Log the current level if not NONE
        if (Logger._level < LogLevel.NONE) {
            const levelName = Object.keys(LogLevel).find(k => LogLevel[k as keyof typeof LogLevel] === Logger._level);
            console.info(`[Logger] Log level: ${levelName}${logParam ? ' (from URL)' : isDev ? ' (dev default)' : ' (prod default)'}`);
        }
    }

    /**
     * Set the global log level programmatically
     * @param {number} level - LogLevel value
     */
    static setLevel(level: LogLevelValue): void {
        Logger._level = level;
    }

    /**
     * Get a logger instance for a specific module
     * @param {string} moduleName - Name of the module (used as prefix)
     * @returns {Object} Logger instance with debug, info, warn, error methods
     */
    static getLogger(moduleName: string): LoggerInstance {
        if (!Logger._initialized) {
            Logger.init();
        }

        // Return cached logger if exists
        if (Logger._loggers.has(moduleName)) {
            return Logger._loggers.get(moduleName)!;
        }

        const prefix = `[${moduleName}]`;

        const logger: LoggerInstance = {
            /**
             * Log debug message (most verbose, for development)
             */
            debug: (...args: unknown[]) => {
                if (Logger._level <= LogLevel.DEBUG) {
                    const timestamp = Logger._showTimestamps ? `[${new Date().toISOString().substr(11, 12)}] ` : '';
                    console.debug(timestamp + prefix, ...args);
                }
            },

            /**
             * Log info message (general information)
             */
            info: (...args: unknown[]) => {
                if (Logger._level <= LogLevel.INFO) {
                    console.info(prefix, ...args);
                }
            },

            /**
             * Log warning message
             */
            warn: (...args: unknown[]) => {
                if (Logger._level <= LogLevel.WARN) {
                    console.warn(prefix, ...args);
                }
            },

            /**
             * Log error message (always shown unless NONE)
             */
            error: (...args: unknown[]) => {
                if (Logger._level <= LogLevel.ERROR) {
                    console.error(prefix, ...args);
                }
            },

            /**
             * Log a group of related messages (collapsible in console)
             * @param {string} label - Group label
             * @param {Function} fn - Function that logs the group contents
             */
            group: (label: string, fn: () => void) => {
                if (Logger._level <= LogLevel.DEBUG) {
                    console.groupCollapsed(prefix + ' ' + label);
                    fn();
                    console.groupEnd();
                }
            },

            /**
             * Log timing information
             * @param {string} label - Timer label
             */
            time: (label: string) => {
                if (Logger._level <= LogLevel.DEBUG) {
                    console.time(prefix + ' ' + label);
                }
            },

            /**
             * End timing and log result
             * @param {string} label - Timer label (must match time() call)
             */
            timeEnd: (label: string) => {
                if (Logger._level <= LogLevel.DEBUG) {
                    console.timeEnd(prefix + ' ' + label);
                }
            }
        };

        Logger._loggers.set(moduleName, logger);
        return logger;
    }

    /**
     * Check if a log level is enabled
     * @param {number} level - LogLevel to check
     * @returns {boolean}
     */
    static isEnabled(level: LogLevelValue): boolean {
        return Logger._level <= level;
    }
}

// Initialize on module load
Logger.init();

export { Logger, LogLevel };
export type { LogLevelValue };
