/**
 * Wrapped database queries module
 *
 * This module provides wrapped versions of query functions
 * that ensure the correct configuration is always used.
 */

import { withCorrectConfig } from './wrapper.js';
import {
    executeQuery,
    listTables,
    describeTable,
    getFieldDescriptions,
    analyzeQueryPerformance,
    getExecutionPlan,
    analyzeMissingIndexes,
    executeBatchQueries,
    describeBatchTables
} from './queries.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('db:wrapped-queries');

// Create wrapped versions of functions that ensure the correct configuration is used
const wrappedExecuteQuery = withCorrectConfig(executeQuery, 2); // config is the third parameter (index 2)
const wrappedListTables = withCorrectConfig(listTables);
const wrappedDescribeTable = withCorrectConfig(describeTable, 1); // config is the second parameter (index 1)
const wrappedGetFieldDescriptions = withCorrectConfig(getFieldDescriptions, 1);
const wrappedAnalyzeQueryPerformance = withCorrectConfig(analyzeQueryPerformance, 3);
const wrappedGetExecutionPlan = withCorrectConfig(getExecutionPlan, 2);
const wrappedAnalyzeMissingIndexes = withCorrectConfig(analyzeMissingIndexes, 1);
const wrappedExecuteBatchQueries = withCorrectConfig(executeBatchQueries, 1); // config is the second parameter (index 1)
const wrappedDescribeBatchTables = withCorrectConfig(describeBatchTables, 1); // config is the second parameter (index 1)

// Export the wrapped versions of functions
export {
    wrappedExecuteQuery as executeQuery,
    wrappedListTables as listTables,
    wrappedDescribeTable as describeTable,
    wrappedGetFieldDescriptions as getFieldDescriptions,
    wrappedAnalyzeQueryPerformance as analyzeQueryPerformance,
    wrappedGetExecutionPlan as getExecutionPlan,
    wrappedAnalyzeMissingIndexes as analyzeMissingIndexes,
    wrappedExecuteBatchQueries as executeBatchQueries,
    wrappedDescribeBatchTables as describeBatchTables
};
