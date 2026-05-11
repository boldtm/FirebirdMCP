/**
 * Database function wrapper module
 * 
 * This module provides wrappers for database functions
 * that ensure the correct configuration is always used.
 */

import { ConfigOptions, getGlobalConfig } from './connection.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('db:wrapper');

/**
 * Wrapper for database functions that ensures the correct configuration is used
 * @param fn Original function that accepts a config parameter
 * @returns Wrapped function that always uses the correct configuration
 */
export function withCorrectConfig<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    configParamIndex: number = -1 // By default, assumes config is the last parameter
): T {
    return (async (...args: any[]) => {
        try {
            // Get the global configuration
            const globalConfig = getGlobalConfig();
            
            // If the config parameter index was not specified, assume it's the last one
            const actualConfigIndex = configParamIndex >= 0 ? configParamIndex : args.length - 1;
            
            // If there is a global config and the config parameter was not provided or is undefined
            if (globalConfig && (!args[actualConfigIndex] || args.length <= actualConfigIndex)) {
                // If we need to extend the arguments array
                if (args.length <= actualConfigIndex) {
                    // Create a new array with the needed length
                    const newArgs = [...args];
                    // Fill with undefined if needed
                    while (newArgs.length < actualConfigIndex) {
                        newArgs.push(undefined);
                    }
                    // Add the global configuration
                    newArgs.push(globalConfig);
                    // Call the original function with the new arguments
                    return await fn(...newArgs);
                } else {
                    // Simply replace the config parameter
                    args[actualConfigIndex] = globalConfig;
                }
            }
            
            // Call the original function with the arguments (possibly modified)
            return await fn(...args);
        } catch (error) {
            // Log the error and rethrow it
            logger.error(`Error in wrapped function: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }) as T;
}

/**
 * Wrapper for database functions that don't have a config parameter
 * @param fn Original function
 * @param configFactory Function that returns the configuration to use
 * @returns Wrapped function
 */
export function withConfig<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    configFactory: () => ConfigOptions
): T {
    return (async (...args: any[]) => {
        try {
            // Get the configuration
            const config = configFactory();
            
            // Add the configuration as the last argument
            const newArgs = [...args, config];
            
            // Call the original function with the new arguments
            return await fn(...newArgs);
        } catch (error) {
            // Log the error and rethrow it
            logger.error(`Error in wrapped function with config: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }) as T;
}
