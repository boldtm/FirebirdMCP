/**
 * Resource limits functionality for the MCP Firebird server
 */

import { securityConfig } from './config.js';
import { createLogger } from '../utils/logger.js';
import { FirebirdError } from '../utils/errors.js';
const logger = createLogger('security:resourceLimits');

// Phase 4.4: Configuration for rate limit map management
const MAX_RATE_LIMIT_ENTRIES = 10000; // Maximum number of sessions to track
const STALE_SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour - sessions older than this are stale
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes - cleanup interval

// Store query counts per session
const sessionQueryCounts: Map<string, number> = new Map();

// Store rate limiting data with last access time for cleanup
interface RateLimitEntry {
    count: number;
    timestamp: number;
    lastAccess: number; // Phase 4.4: Track last access for stale session cleanup
}
const rateLimitData: Map<string, RateLimitEntry> = new Map();

// Phase 4.4: Cleanup interval reference
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Phase 4.4: Clean up stale sessions from rate limit maps
 * Removes entries older than STALE_SESSION_TIMEOUT_MS
 */
function cleanupStaleSessions(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [sessionId, data] of rateLimitData.entries()) {
        if (now - data.lastAccess > STALE_SESSION_TIMEOUT_MS) {
            rateLimitData.delete(sessionId);
            sessionQueryCounts.delete(sessionId);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        logger.debug(`Cleaned up ${cleaned} stale sessions from rate limit maps`);
    }
}

/**
 * Phase 4.4: Enforce max entries limit with LRU eviction
 * Removes oldest entries when map exceeds MAX_RATE_LIMIT_ENTRIES
 */
function enforceMaxEntries(): void {
    if (rateLimitData.size <= MAX_RATE_LIMIT_ENTRIES) {
        return;
    }
    
    // Find and remove the oldest 10% of entries (LRU eviction)
    const entriesToDelete = Math.ceil(MAX_RATE_LIMIT_ENTRIES * 0.1);
    const entries = Array.from(rateLimitData.entries())
        .sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    
    for (let i = 0; i < entriesToDelete && i < entries.length; i++) {
        const [sessionId] = entries[i];
        rateLimitData.delete(sessionId);
        sessionQueryCounts.delete(sessionId);
    }
    
    logger.debug(`Evicted ${entriesToDelete} oldest sessions from rate limit maps (LRU)`);
}

/**
 * Phase 4.4: Start the cleanup interval
 * Should be called during server initialization
 */
export function startCleanupInterval(): void {
    if (cleanupInterval) {
        return; // Already running
    }
    cleanupInterval = setInterval(cleanupStaleSessions, CLEANUP_INTERVAL_MS);
    logger.info('Started rate limit cleanup interval');
}

/**
 * Phase 4.4: Stop the cleanup interval
 * Should be called during server shutdown
 */
export function stopCleanupInterval(): void {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        logger.info('Stopped rate limit cleanup interval');
    }
}

/**
 * Check if a query exceeds the maximum allowed rows
 * @param {number} rowCount - Number of rows in the result
 * @param {string} sessionId - Session identifier
 * @returns {boolean} Whether the query exceeds the maximum allowed rows
 * @throws {FirebirdError} If the query exceeds the maximum allowed rows
 */
export function checkRowLimit(rowCount: number, sessionId: string = 'default'): boolean {
    if (!securityConfig.resourceLimits?.maxRowsPerQuery) {
        return true;
    }

    if (rowCount > securityConfig.resourceLimits.maxRowsPerQuery) {
        const errorMessage = `Query result exceeds maximum allowed rows (${rowCount} > ${securityConfig.resourceLimits.maxRowsPerQuery})`;
        logger.warn(`${errorMessage} for session ${sessionId}`);
        throw new FirebirdError(errorMessage, 'RESOURCE_LIMIT_EXCEEDED');
    }

    return true;
}

/**
 * Check if a query exceeds the maximum allowed response size
 * @param {any} result - Query result
 * @param {string} sessionId - Session identifier
 * @returns {boolean} Whether the query exceeds the maximum allowed response size
 * @throws {FirebirdError} If the query exceeds the maximum allowed response size
 */
export function checkResponseSizeLimit(result: any, sessionId: string = 'default'): boolean {
    if (!securityConfig.resourceLimits?.maxResponseSize) {
        return true;
    }

    // Estimate the size of the result
    const resultSize = estimateObjectSize(result);

    if (resultSize > securityConfig.resourceLimits.maxResponseSize) {
        const errorMessage = `Query result exceeds maximum allowed size (${resultSize} bytes > ${securityConfig.resourceLimits.maxResponseSize} bytes)`;
        logger.warn(`${errorMessage} for session ${sessionId}`);
        throw new FirebirdError(errorMessage, 'RESOURCE_LIMIT_EXCEEDED');
    }

    return true;
}

/**
 * Check if a session exceeds the maximum allowed queries
 * @param {string} sessionId - Session identifier
 * @returns {boolean} Whether the session exceeds the maximum allowed queries
 * @throws {FirebirdError} If the session exceeds the maximum allowed queries
 */
export function checkQueryCountLimit(sessionId: string = 'default'): boolean {
    if (!securityConfig.resourceLimits?.maxQueriesPerSession) {
        return true;
    }

    // Get the current query count for the session
    const queryCount = sessionQueryCounts.get(sessionId) || 0;

    // Increment the query count
    sessionQueryCounts.set(sessionId, queryCount + 1);

    if (queryCount >= securityConfig.resourceLimits.maxQueriesPerSession) {
        const errorMessage = `Session exceeds maximum allowed queries (${queryCount} >= ${securityConfig.resourceLimits.maxQueriesPerSession})`;
        logger.warn(`${errorMessage} for session ${sessionId}`);
        throw new FirebirdError(errorMessage, 'RESOURCE_LIMIT_EXCEEDED');
    }

    return true;
}

/**
 * Check if a session exceeds the rate limit
 * Uses atomic update pattern to prevent race conditions (Phase 6.3)
 * @param {string} sessionId - Session identifier
 * @returns {boolean} Whether the session exceeds the rate limit
 * @throws {FirebirdError} If the session exceeds the rate limit
 */
export function checkRateLimit(sessionId: string = 'default'): boolean {
    if (!securityConfig.resourceLimits?.rateLimit) {
        return true;
    }

    const { queriesPerMinute, burstLimit } = securityConfig.resourceLimits.rateLimit;
    const now = Date.now();

    // Phase 6.3: Atomic update pattern - compute new value first, then set
    // This prevents race conditions where multiple requests could read the same stale value
    let newData: RateLimitEntry;
    const existingData = rateLimitData.get(sessionId);
    
    if (!existingData) {
        // New session
        newData = { count: 1, timestamp: now, lastAccess: now };
    } else {
        // Check if a minute has passed since the last reset
        const elapsed = now - existingData.timestamp;

        if (elapsed >= 60000) {
            // Reset the count if a minute has passed
            newData = { count: 1, timestamp: now, lastAccess: now };
        } else {
            // Increment the count and update last access
            const newCount = existingData.count + 1;
            
            // Check if the count exceeds the burst limit
            if (newCount > burstLimit) {
                const errorMessage = `Session exceeds burst limit (${newCount} > ${burstLimit})`;
                logger.warn(`${errorMessage} for session ${sessionId}`);
                throw new FirebirdError(errorMessage, 'RATE_LIMIT_EXCEEDED');
            }

            // Check if the rate exceeds the queries per minute limit
            const rate = newCount / (elapsed / 60000);
            if (rate > queriesPerMinute) {
                const errorMessage = `Session exceeds queries per minute limit (${rate.toFixed(2)} > ${queriesPerMinute})`;
                logger.warn(`${errorMessage} for session ${sessionId}`);
                throw new FirebirdError(errorMessage, 'RATE_LIMIT_EXCEEDED');
            }
            
            newData = { count: newCount, timestamp: existingData.timestamp, lastAccess: now };
        }
    }

    // Phase 6.3: Single atomic set operation
    rateLimitData.set(sessionId, newData);
    
    // Phase 4.4: Enforce max entries after adding new entry
    enforceMaxEntries();

    return true;
}

/**
 * Reset the query count for a session
 * @param {string} sessionId - Session identifier
 */
export function resetQueryCount(sessionId: string = 'default'): void {
    sessionQueryCounts.delete(sessionId);
}

/**
 * Reset the rate limit data for a session
 * @param {string} sessionId - Session identifier
 */
export function resetRateLimit(sessionId: string = 'default'): void {
    rateLimitData.delete(sessionId);
}

/**
 * Estimate the size of an object in bytes
 * @param {any} obj - Object to estimate the size of
 * @returns {number} Estimated size in bytes
 */
function estimateObjectSize(obj: any): number {
    const objectList = new Set();
    return calculateSize(obj, objectList);
}

/**
 * Calculate the size of an object in bytes
 * @param {any} object - Object to calculate the size of
 * @param {Set<any>} objectList - Set of objects already processed
 * @returns {number} Size in bytes
 */
function calculateSize(object: any, objectList: Set<any>): number {
    if (object === null || object === undefined) {
        return 0;
    }

    if (typeof object !== 'object') {
        // Handle primitive types
        if (typeof object === 'string') {
            return object.length * 2; // UTF-16 characters are 2 bytes each
        }
        if (typeof object === 'number') {
            return 8; // Numbers are 8 bytes
        }
        if (typeof object === 'boolean') {
            return 4; // Booleans are 4 bytes
        }
        return 0;
    }

    // Check for circular references
    if (objectList.has(object)) {
        return 0;
    }

    objectList.add(object);

    let size = 0;

    if (Array.isArray(object)) {
        // Calculate size of array elements
        for (const item of object) {
            size += calculateSize(item, objectList);
        }
    } else {
        // Calculate size of object properties
        for (const key in object) {
            if (Object.prototype.hasOwnProperty.call(object, key)) {
                size += key.length * 2; // Key name
                size += calculateSize(object[key], objectList); // Value
            }
        }
    }

    return size;
}
