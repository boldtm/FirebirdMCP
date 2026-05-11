/**
 * Database module index
 *
 * This module exports all database functions,
 * using the wrapped versions that ensure the correct configuration is always used.
 */

// Export the wrapped versions of query functions
export * from './wrapped-queries.js';

// Export other functions and types
export {
    DEFAULT_CONFIG,
    getGlobalConfig,
    connectToDatabase,
    queryDatabase
} from './connection.js';

export type { ConfigOptions } from './connection.js';

export {
    getDatabases,
    getViews,
    getProcedures,
    DATABASE_DIR,
    executeBatchQueries,
    describeBatchTables
} from './queries.js';

export type {
    DatabaseInfo,
    TableInfo,
    FieldInfo,
    ColumnInfo,
    QueryPerformanceResult,
    ExecutionPlanResult
} from './queries.js';

// Exportar funciones de gestión de base de datos
export * from './management.js';

// Exportar funciones de esquema
export * from './schema.js';
