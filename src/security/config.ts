/**
 * Security configuration for the MCP Firebird server
 * Implements the security features mentioned in the README
 */

import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
const logger = createLogger('security:config');
import * as fs from 'fs';
import * as path from 'path';

/**
 * Schema for data masking configuration
 */
export const DataMaskingSchema = z.array(z.object({
    columns: z.array(z.string()).min(1),
    pattern: z.string().or(z.instanceof(RegExp)),
    replacement: z.string()
}));

/**
 * Schema for row filters configuration
 */
export const RowFiltersSchema = z.record(z.string(), z.string());

/**
 * Schema for audit configuration
 */
export const AuditConfigSchema = z.object({
    enabled: z.boolean().default(false),
    destination: z.enum(['file', 'database', 'both']).default('file'),
    auditFile: z.string().optional(),
    auditTable: z.string().optional(),
    detailLevel: z.enum(['basic', 'medium', 'full']).default('medium'),
    logQueries: z.boolean().default(true),
    logResponses: z.boolean().default(false),
    logParameters: z.boolean().default(true)
});

/**
 * Schema for resource limits configuration
 */
export const ResourceLimitsSchema = z.object({
    maxRowsPerQuery: z.number().int().positive().default(5000),
    maxResponseSize: z.number().int().positive().default(5 * 1024 * 1024), // 5 MB
    maxQueryCpuTime: z.number().int().positive().default(10000), // 10 seconds
    maxQueriesPerSession: z.number().int().positive().default(100),
    rateLimit: z.object({
        queriesPerMinute: z.number().int().positive().default(60),
        burstLimit: z.number().int().positive().default(20)
    }).optional()
});

/**
 * Schema for authorization configuration
 */
export const AuthorizationSchema = z.object({
    type: z.enum(['none', 'basic', 'oauth2']).default('none'),
    oauth2: z.object({
        tokenVerifyUrl: z.string().url(),
        clientId: z.string(),
        clientSecret: z.string(),
        scope: z.string().optional(),
        timeoutMs: z.number().int().positive().default(10000) // Phase 4.3: Configurable timeout
    }).optional(),
    rolePermissions: z.record(z.string(), z.object({
        tables: z.array(z.string()).optional(),
        allTablesAllowed: z.boolean().optional(),
        operations: z.array(z.enum(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'EXECUTE', 'ALTER'])).optional()
    })).optional()
});

/**
 * Schema for security configuration
 */
export const SecurityConfigSchema = z.object({
    allowedTables: z.array(z.string()).optional(),
    forbiddenTables: z.array(z.string()).optional(),
    tableNamePattern: z.string().optional(),
    allowedOperations: z.array(z.string()).optional(),
    forbiddenOperations: z.array(z.string()).optional(),
    maxRows: z.number().int().positive().optional(),
    queryTimeout: z.number().int().positive().optional(),
    dataMasking: DataMaskingSchema.optional(),
    rowFilters: RowFiltersSchema.optional(),
    audit: AuditConfigSchema.optional(),
    resourceLimits: ResourceLimitsSchema.optional(),
    authorization: AuthorizationSchema.optional()
});

/**
 * Default security configuration
 */
export const DEFAULT_SECURITY_CONFIG = {
    allowedOperations: ['SELECT', 'EXECUTE'],
    forbiddenOperations: ['DROP', 'TRUNCATE', 'ALTER', 'GRANT', 'REVOKE'],
    maxRows: 1000,
    queryTimeout: 5000,
    audit: {
        enabled: false,
        destination: 'file' as 'file' | 'database' | 'both',
        auditFile: './logs/audit.log',
        detailLevel: 'medium' as 'basic' | 'medium' | 'full',
        logQueries: true,
        logResponses: false,
        logParameters: true
    },
    resourceLimits: {
        maxRowsPerQuery: 5000,
        maxResponseSize: 5 * 1024 * 1024, // 5 MB
        maxQueryCpuTime: 10000, // 10 seconds
        maxQueriesPerSession: 100,
        rateLimit: {
            queriesPerMinute: 60,
            burstLimit: 20
        }
    }
};

/**
 * Security configuration
 */
export interface SecurityConfig {
    allowedTables?: string[];
    forbiddenTables?: string[];
    tableNamePattern?: string;
    allowedOperations?: string[];
    forbiddenOperations?: string[];
    maxRows?: number;
    queryTimeout?: number;
    dataMasking?: {
        columns: string[];
        pattern: string | RegExp;
        replacement: string;
    }[];
    rowFilters?: Record<string, string>;
    audit?: {
        enabled: boolean;
        destination: 'file' | 'database' | 'both';
        auditFile?: string;
        auditTable?: string;
        detailLevel: 'basic' | 'medium' | 'full';
        logQueries: boolean;
        logResponses: boolean;
        logParameters: boolean;
    };
    resourceLimits?: {
        maxRowsPerQuery: number;
        maxResponseSize: number;
        maxQueryCpuTime: number;
        maxQueriesPerSession: number;
        rateLimit?: {
            queriesPerMinute: number;
            burstLimit: number;
        };
    };
    authorization?: {
        type: 'none' | 'basic' | 'oauth2';
        oauth2?: {
            tokenVerifyUrl: string;
            clientId: string;
            clientSecret: string;
            scope?: string;
            timeoutMs?: number; // Phase 4.3: Configurable timeout for OAuth2 token verification
        };
        rolePermissions?: Record<string, {
            tables?: string[];
            allTablesAllowed?: boolean;
            operations?: ('SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE' | 'DROP' | 'EXECUTE' | 'ALTER')[];
        }>;
    };
}

/**
 * Load security configuration from a file
 * @param {string} configPath - Path to the configuration file
 * @returns {SecurityConfig} Security configuration
 */
export function loadSecurityConfig(configPath?: string): SecurityConfig {
    let config: SecurityConfig = { ...DEFAULT_SECURITY_CONFIG };

    // If a config path is provided, try to load it
    if (configPath) {
        try {
            if (fs.existsSync(configPath)) {
                const configFile = require(path.resolve(configPath));

                if (configFile && configFile.security) {
                    // Validate the configuration
                    const result = SecurityConfigSchema.safeParse(configFile.security);

                    if (result.success) {
                        config = { ...DEFAULT_SECURITY_CONFIG, ...result.data };
                        logger.info(`Loaded security configuration from ${configPath}`);
                    } else {
                        logger.error(`Invalid security configuration in ${configPath}: ${result.error.message}`);
                        logger.warn('Using default security configuration');
                    }
                } else {
                    logger.warn(`No security configuration found in ${configPath}`);
                    logger.warn('Using default security configuration');
                }
            } else {
                logger.warn(`Configuration file not found: ${configPath}`);
                logger.warn('Using default security configuration');
            }
        } catch (error: any) {
            logger.error(`Error loading security configuration: ${error.message}`);
            logger.warn('Using default security configuration');
        }
    } else {
        logger.info('No security configuration file provided, using default configuration');
    }

    return config;
}

/**
 * Phase 6.1: Global security configuration instance (private)
 * Use getSecurityConfig() to access the configuration
 */
let _securityConfig: SecurityConfig = { ...DEFAULT_SECURITY_CONFIG };

/**
 * Phase 6.1: Get the current security configuration (immutable access)
 * Returns a copy to prevent external mutation
 * @returns {SecurityConfig} Current security configuration
 */
export function getSecurityConfig(): SecurityConfig {
    return { ..._securityConfig };
}

/**
 * Phase 6.1: For backward compatibility - use getSecurityConfig() instead
 * This is a getter that returns a copy to prevent mutation
 */
export const securityConfig: SecurityConfig = new Proxy({} as SecurityConfig, {
    get(_target, prop) {
        return _securityConfig[prop as keyof SecurityConfig];
    },
    set() {
        logger.error('Direct mutation of securityConfig is not allowed. Use initSecurityConfig() instead.');
        return false; // Prevent mutation
    }
});

/**
 * Initialize security configuration
 * Phase 6.1: Creates new config object instead of mutating global state
 * @param {string} configPath - Path to the configuration file
 */
export function initSecurityConfig(configPath?: string): void {
    const config = loadSecurityConfig(configPath);

    // Phase 6.1: Replace the entire config object instead of mutating
    _securityConfig = { ...DEFAULT_SECURITY_CONFIG, ...config };

    // Initialize audit logging if enabled
    if (_securityConfig.audit?.enabled) {
        initAuditLogging(_securityConfig.audit);
    }

    logger.info('Security configuration initialized');
}

/**
 * Initialize audit logging
 * @param {SecurityConfig['audit']} auditConfig - Audit configuration
 */
function initAuditLogging(auditConfig: NonNullable<SecurityConfig['audit']>): void {
    if (auditConfig.destination === 'file' || auditConfig.destination === 'both') {
        if (!auditConfig.auditFile) {
            auditConfig.auditFile = './logs/audit.log';
            logger.warn(`No audit file specified, using default: ${auditConfig.auditFile}`);
        }

        // Ensure the audit directory exists
        const auditDir = path.dirname(auditConfig.auditFile);
        if (!fs.existsSync(auditDir)) {
            fs.mkdirSync(auditDir, { recursive: true });
            logger.info(`Created audit log directory: ${auditDir}`);
        }

        logger.info(`Audit logging enabled to file: ${auditConfig.auditFile}`);
    }

    if (auditConfig.destination === 'database' || auditConfig.destination === 'both') {
        if (!auditConfig.auditTable) {
            auditConfig.auditTable = 'MCP_AUDIT_LOG';
            logger.warn(`No audit table specified, using default: ${auditConfig.auditTable}`);
        }

        logger.info(`Audit logging enabled to database table: ${auditConfig.auditTable}`);
    }

    logger.info(`Audit logging initialized with detail level: ${auditConfig.detailLevel}`);
}
