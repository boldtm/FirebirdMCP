/**
 * Security module for the MCP Firebird server
 */

export * from './config.js';
export * from './audit.js';
export * from './dataMasking.js';
export * from './resourceLimits.js';
export * from './authorization.js';

import { initSecurityConfig } from './config.js';
import { createAuditTable } from './audit.js';
import { createLogger } from '../utils/logger.js';
import { MCPError } from '../utils/errors.js';
const logger = createLogger('security:index');

/**
 * Initialize the security module
 * @param {string} configPath - Path to the security configuration file
 * @throws {MCPError} If initialization fails (error is rethrown after logging)
 */
export async function initSecurity(configPath?: string): Promise<void> {
    try {
        // Initialize security configuration
        initSecurityConfig(configPath);

        // Create audit table if needed
        await createAuditTable();

        logger.info('Security module initialized successfully');
    } catch (error: any) {
        logger.error(`Error initializing security module: ${error.message}`);
        // Phase 2.1: Rethrow error to prevent server from starting with uninitialized security
        throw new MCPError(
            `Security initialization failed: ${error.message}`,
            'SECURITY_INITIALIZATION_ERROR',
            error
        );
    }
}
