/**
 * Database connection module for MCP Firebird
 * Provides functionality for connecting to Firebird databases
 */

import Firebird from 'node-firebird';
import { createLogger } from '../utils/logger.js';
import { FirebirdError, ErrorTypes } from '../utils/errors.js';
import { DriverFactory } from './driver-factory.js';

const logger = createLogger('db:connection');

/**
 * Type for a Firebird query result
 */
export interface FirebirdQueryResult {
    [key: string]: unknown;
}

/**
 * Type for a Firebird connection object
 */
export interface FirebirdDatabase {
    query: (sql: string, params: unknown[], callback: (err: Error | null, results?: FirebirdQueryResult[]) => void) => void;
    detach: (callback: (err: Error | null) => void) => void;
    [key: string]: unknown;
}

/**
 * Interface that defines configuration options for the Firebird connection
 */
export interface ConfigOptions {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    lowercase_keys?: boolean;
    role?: string;
    pageSize?: number;
    /**
     * Wire encryption setting for Firebird 3.0+
     * - 'Disabled': No wire encryption (compatible with all versions)
     * - 'Enabled': Wire encryption enabled if supported
     * - 'Required': Wire encryption required
     * Default: 'Disabled' for maximum compatibility
     */
    wireCrypt?: 'Disabled' | 'Enabled' | 'Required';
}

import * as path from 'path';

/**
 * Normalize database path - preserve remote and Unix paths
 * Only normalizes local Windows paths to avoid breaking remote connections
 * and Unix/Linux absolute paths
 *
 * @param dbPath - Database path to normalize
 * @returns Normalized database path
 */
export function normalizeDatabasePath(dbPath: string | undefined): string {
    if (!dbPath) return '';

    // Don't normalize if:
    // 1. Starts with / (Unix/Linux absolute path)
    // 2. Contains :/ (remote connection string like 'hostname:/path/to/db.fdb')
    // 3. Running on non-Windows platform
    if (dbPath.startsWith('/') ||
        dbPath.includes(':/') ||
        process.platform !== 'win32') {
        return dbPath;
    }

    // Only normalize local Windows paths
    return path.normalize(dbPath);
}

// Get configuration from global variable
export const getGlobalConfig = (): ConfigOptions | null => {
    try {
        if ((global as any).MCP_FIREBIRD_CONFIG) {
            const config = (global as any).MCP_FIREBIRD_CONFIG;
            console.error('Using global database configuration');
            console.error(`Global config: database=${config.database}, host=${config.host}, port=${config.port}, user=${config.user}`);
            return config;
        } else {
            console.error('No global database configuration found');
        }
    } catch (error) {
        console.error(`Error getting global configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
};

// Default configuration for the connection
export const getDefaultConfig = (): ConfigOptions => {
    // First try to load from global configuration
    const globalConfig = getGlobalConfig();
    if (globalConfig && globalConfig.database) {
        console.error('Using global configuration');
        return globalConfig;
    }

    // Debug: Log all environment variables related to database connection
    console.error('Environment variables for database connection:');
    console.error(`FIREBIRD_DATABASE: ${process.env.FIREBIRD_DATABASE || 'not set'}`);
    console.error(`FB_DATABASE: ${process.env.FB_DATABASE || 'not set'}`);
    console.error(`FIREBIRD_HOST: ${process.env.FIREBIRD_HOST || 'not set'}`);
    console.error(`FB_HOST: ${process.env.FB_HOST || 'not set'}`);
    console.error(`FIREBIRD_PORT: ${process.env.FIREBIRD_PORT || 'not set'}`);
    console.error(`FB_PORT: ${process.env.FB_PORT || 'not set'}`);
    console.error(`FIREBIRD_USER: ${process.env.FIREBIRD_USER || 'not set'}`);
    console.error(`FB_USER: ${process.env.FB_USER || 'not set'}`);
    // Don't log passwords
    console.error(`FIREBIRD_ROLE: ${process.env.FIREBIRD_ROLE || 'not set'}`);
    console.error(`FB_ROLE: ${process.env.FB_ROLE || 'not set'}`);
    console.error(`FIREBIRD_WIRECRYPT: ${process.env.FIREBIRD_WIRECRYPT || 'not set'}`);
    console.error(`FB_WIRECRYPT: ${process.env.FB_WIRECRYPT || 'not set'}`);

    // Check for global configuration first (set by CLI)
    const globalConfigFromEnv = (global as any).MCP_FIREBIRD_CONFIG;

    // Get WireCrypt setting with proper validation
    const wireCryptValue = globalConfigFromEnv?.wireCrypt ||
                          process.env.FIREBIRD_WIRECRYPT ||
                          process.env.FB_WIRECRYPT ||
                          'Disabled';

    // Validate WireCrypt value
    const validWireCryptValues: Array<'Disabled' | 'Enabled' | 'Required'> = ['Disabled', 'Enabled', 'Required'];
    const wireCrypt = validWireCryptValues.includes(wireCryptValue as any)
        ? (wireCryptValue as 'Disabled' | 'Enabled' | 'Required')
        : 'Disabled';

    const config = {
        host: globalConfigFromEnv?.host || process.env.FIREBIRD_HOST || process.env.FB_HOST || '127.0.0.1', // Use 127.0.0.1 instead of 'localhost'
        port: parseInt(String(globalConfigFromEnv?.port || process.env.FIREBIRD_PORT || process.env.FB_PORT || '3050'), 10),
        database: normalizeDatabasePath(globalConfigFromEnv?.database || process.env.FIREBIRD_DATABASE || process.env.FB_DATABASE),
        user: globalConfigFromEnv?.user || process.env.FIREBIRD_USER || process.env.FB_USER || 'SYSDBA',
        password: globalConfigFromEnv?.password || process.env.FIREBIRD_PASSWORD || process.env.FB_PASSWORD || '', // Phase 4.1: No default password
        role: globalConfigFromEnv?.role || process.env.FIREBIRD_ROLE || process.env.FB_ROLE || undefined,
        pageSize: globalConfigFromEnv?.pageSize || 4096,
        wireCrypt: wireCrypt
    };

    // Debug: Log the final configuration (without password)
    logger.debug('Final database configuration:');
    logger.debug(`host: ${config.host}`);
    logger.debug(`port: ${config.port}`);
    logger.debug(`database: ${config.database}`);
    logger.debug(`user: ${config.user}`);
    logger.debug(`role: ${config.role || 'Not specified'}`);
    logger.debug(`wireCrypt: ${config.wireCrypt || 'Not specified'}`);
    logger.debug(`pageSize: ${config.pageSize}`);

    // Phase 7.1: Log warning if password is empty
    if (!config.password) {
        logger.warn('No database password provided. Set FIREBIRD_PASSWORD environment variable.');
    }

    return config;
};

// For backward compatibility
export const DEFAULT_CONFIG: ConfigOptions = {
    host: '127.0.0.1', // Use 127.0.0.1 instead of 'localhost'
    port: 3050,
    database: '',
    user: 'SYSDBA',
    password: '', // Phase 4.1: Removed hardcoded 'masterkey' default
    role: undefined,
    pageSize: 4096
};


// FirebirdError is now imported from '../utils/errors.js'

/**
 * Establishes a connection to the database using the appropriate driver
 * @param config - Database connection configuration
 * @returns Database connection object
 * @throws {FirebirdError} Categorized error if the connection fails
 */
export const connectToDatabase = async (inputConfig?: ConfigOptions): Promise<FirebirdDatabase> => {
    // Phase 6.2: Create new config object instead of mutating parameter
    const config = inputConfig ? { ...inputConfig } : getDefaultConfig();
    
    logger.info(`Connecting to ${config.host}:${config.port}/${config.database}`);

    // Phase 4.1: Verify password is provided
    if (!config.password) {
        throw new FirebirdError(
            'Database password is required. Set FIREBIRD_PASSWORD environment variable or provide password in config.',
            ErrorTypes.SECURITY_AUTHENTICATION
        );
    }

    // Phase 4.2: Verify database path is provided - throw error instead of using hardcoded path
    if (!config.database) {
        throw new FirebirdError(
            'Database path is required. Set FIREBIRD_DATABASE environment variable or provide database path in config.',
            ErrorTypes.DATABASE_CONNECTION
        );
    }

    // Log connection attempt with full details
    // Phase 7.1: Use logger instead of console.error
    logger.debug('Attempting to connect with the following configuration:');
    logger.debug(`- Host: ${config.host}`);
    logger.debug(`- Port: ${config.port}`);
    logger.debug(`- Database: ${config.database}`);
    logger.debug(`- User: ${config.user}`);
    logger.debug(`- Role: ${config.role || 'Not specified'}`);
    logger.debug(`- WireCrypt: ${config.wireCrypt || 'Not specified'}`);

    try {
        // Get appropriate driver from factory
        const driver = await DriverFactory.getDriver();
        const driverInfo = await DriverFactory.getDriverInfo();

        logger.info(`Using driver: ${driverInfo.current}`, {
            supportsWireEncryption: driverInfo.supportsWireEncryption,
            nativeAvailable: driverInfo.nativeAvailable
        });

        // Warn if wire encryption is requested but not supported
        if (config.wireCrypt && config.wireCrypt !== 'Disabled' && !driverInfo.supportsWireEncryption) {
            logger.warn(
                'Wire encryption requested but current driver does not support it. ' +
                'Use --use-native-driver flag to enable wire encryption support.'
            );
        }

        // Connect using the selected driver
        const db = await driver.attach(config);
        logger.info('Connection established successfully');

        return db;
    } catch (error) {
        // Categorize the error for better handling
        let errorType = ErrorTypes.DATABASE_CONNECTION;
        let errorMsg = `Error connecting to database: ${error instanceof Error ? error.message : String(error)}`;

        if (error instanceof Error) {
            if (error.message.includes('service is not defined')) {
                errorType = ErrorTypes.DATABASE_CONNECTION;
                errorMsg = 'Firebird service is not available. Verify that the Firebird server is running.';
            } else if (error.message.includes('ECONNREFUSED')) {
                errorType = ErrorTypes.DATABASE_CONNECTION;
                errorMsg = `Connection refused at ${config.host}:${config.port}. Verify that the Firebird server is running and accessible at this address.`;
            } else if (error.message.includes('ENOENT')) {
                errorType = ErrorTypes.DATABASE_CONNECTION;
                errorMsg = `Database not found: ${config.database}. Verify the path and permissions.`;
            } else if (error.message.includes('password') || error.message.includes('user')) {
                errorType = ErrorTypes.SECURITY_AUTHENTICATION;
                errorMsg = 'Authentication error. Verify username and password.';
            } else if (error.message.includes('ETIMEDOUT')) {
                errorType = ErrorTypes.DATABASE_CONNECTION;
                errorMsg = `Connection timed out at ${config.host}:${config.port}. Verify that the Firebird server is accessible and not blocked by a firewall.`;
            } else if (error.message.includes('EHOSTUNREACH')) {
                errorType = ErrorTypes.DATABASE_CONNECTION;
                errorMsg = `Host unreachable at ${config.host}:${config.port}. Verify network connectivity and that the host exists.`;
            }
        }

        logger.error(errorMsg, { originalError: error });
        throw new FirebirdError(errorMsg, errorType, error);
    }
};

/**
 * Ejecuta una consulta en la base de datos
 * @param {FirebirdDatabase} db - Objeto de conexión a la base de datos
 * @param {string} sql - Consulta SQL a ejecutar
 * @param {Array} params - Parámetros para la consulta
 * @returns {Promise<any[]>} Resultado de la consulta
 * @throws {FirebirdError} Error categorizado si la consulta falla
 */
export const queryDatabase = (db: FirebirdDatabase, sql: string, params: unknown[] = []): Promise<FirebirdQueryResult[]> => {
    return new Promise((resolve, reject) => {
        logger.info(`Ejecutando consulta: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);

        db.query(sql, params, (err: Error | null, result: FirebirdQueryResult[] | undefined) => {
            if (err) {
                // Categorizar el error para mejor manejo
                let errorType = 'QUERY_ERROR';

                // Intentar categorizar el error según su contenido
                if (err.message.includes('syntax error')) {
                    errorType = 'SYNTAX_ERROR';
                } else if (err.message.includes('not defined')) {
                    errorType = 'OBJECT_NOT_FOUND';
                } else if (err.message.includes('permission')) {
                    errorType = 'PERMISSION_ERROR';
                } else if (err.message.includes('deadlock')) {
                    errorType = 'DEADLOCK_ERROR';
                } else if (err.message.includes('timeout')) {
                    errorType = 'TIMEOUT_ERROR';
                }

                // Crear un error más informativo
                const error = new FirebirdError(
                    `Error al ejecutar consulta: ${err.message}`,
                    errorType,
                    err
                );

                logger.error(`${error.message} [${errorType}]`);
                reject(error);
                return;
            }

            // Si no hay resultados, devolver un array vacío
            if (!result) {
                result = [];
            }

            logger.info(`Consulta ejecutada exitosamente, ${result.length} filas obtenidas`);
            resolve(result);
        });
    });
};

/**
 * Prueba la conexión a la base de datos usando la configuración proporcionada.
 * Intenta conectar y desconectar inmediatamente.
 * @param {ConfigOptions} [config=DEFAULT_CONFIG] - Configuración a usar para la prueba.
 * @returns {Promise<void>} Resuelve si la conexión es exitosa, rechaza si falla.
 * @throws {FirebirdError} Error categorizado si la conexión falla.
 */
export const testConnection = async (config = getDefaultConfig()): Promise<void> => {
    logger.info('Probando conexión a la base de datos...');
    let db: FirebirdDatabase | null = null;
    try {
        db = await connectToDatabase(config);
        logger.info('Prueba de conexión exitosa.');
    } catch (error) {
        logger.error('Prueba de conexión fallida.');
        // El error ya debería ser un FirebirdError de connectToDatabase
        throw error;
    } finally {
        if (db) {
            await new Promise<void>((resolve, reject) => {
                db?.detach((detachErr: Error | null) => {
                    if (detachErr) {
                        logger.warn(`Error al cerrar conexión de prueba: ${detachErr.message}`);
                        // No rechazamos la promesa principal por un error de detach,
                        // pero sí lo registramos.
                    }
                    resolve();
                });
            });
        }
    }
};

// Se ha eliminado la función executeQuery ya que está duplicada
// La implementación mejorada se mantiene en queries.ts con validación de SQL
// y manejo de errores más robusto
