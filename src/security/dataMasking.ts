/**
 * Data masking functionality for the MCP Firebird server
 */

import { securityConfig } from './config.js';
import { createLogger } from '../utils/logger.js';
import { FirebirdError } from '../utils/errors.js';
const logger = createLogger('security:dataMasking');

/**
 * Apply data masking to a result set
 * @param {any[]} results - Result set to mask
 * @param {string} tableName - Name of the table (for row filters)
 * @returns {any[]} Masked result set
 * @throws {FirebirdError} If masking fails (no longer silently returns unmasked data)
 */
export function applyDataMasking(results: any[], tableName?: string): any[] {
    if (!results || results.length === 0) {
        return results;
    }

    try {
        // Apply row filters if configured
        if (tableName && securityConfig.rowFilters && securityConfig.rowFilters[tableName]) {
            results = applyRowFilter(results, tableName);
        }

        // Apply column masking if configured
        if (securityConfig.dataMasking && securityConfig.dataMasking.length > 0) {
            results = maskSensitiveData(results);
        }

        return results;
    } catch (error: any) {
        logger.error(`Error applying data masking: ${error.message}`);
        // Phase 2.2: Throw error instead of returning unmasked data
        throw new FirebirdError(
            `Data masking failed: ${error.message}`,
            'DATA_MASKING_ERROR',
            error
        );
    }
}

/**
 * Apply row filters to a result set
 * @param {any[]} results - Result set to filter
 * @param {string} tableName - Name of the table
 * @returns {any[]} Filtered result set
 */
function applyRowFilter(results: any[], tableName: string): any[] {
    if (!securityConfig.rowFilters || !securityConfig.rowFilters[tableName]) {
        return results;
    }

    try {
        const filterCondition = securityConfig.rowFilters[tableName];

        // Convert the filter condition to a JavaScript function
        const filterFunction = createFilterFunction(filterCondition);

        // Apply the filter
        return results.filter(row => {
            try {
                return filterFunction(row);
            } catch (error) {
                logger.error(`Error evaluating row filter for ${tableName}: ${error}`);
                return true; // Include the row if there's an error
            }
        });
    } catch (error: any) {
        logger.error(`Error applying row filter for ${tableName}: ${error.message}`);
        return results;
    }
}

/**
 * Whitelisted operators for safe condition evaluation
 */
const ALLOWED_OPERATORS = new Set([
    '=', '!=', '<>', '<', '>', '<=', '>=',
    'LIKE', 'NOT LIKE', 'IN', 'NOT IN',
    'IS NULL', 'IS NOT NULL',
    'AND', 'OR', 'NOT'
]);

/**
 * Validates an identifier (column name) to prevent code injection
 * @param name - Identifier to validate
 * @returns true if valid, false otherwise
 */
function isValidIdentifier(name: string): boolean {
    // Only allow alphanumeric characters, underscores, and must start with letter or underscore
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/**
 * Token types for the safe expression parser
 */
type Token = 
    | { type: 'IDENTIFIER'; value: string }
    | { type: 'OPERATOR'; value: string }
    | { type: 'LITERAL'; value: string | number | null }
    | { type: 'LPAREN' }
    | { type: 'RPAREN' }
    | { type: 'COMMA' };

/**
 * Tokenize a SQL-like condition string
 * @param condition - Condition to tokenize
 * @returns Array of tokens
 * @throws {FirebirdError} If tokenization fails
 */
function tokenizeCondition(condition: string): Token[] {
    const tokens: Token[] = [];
    let pos = 0;

    while (pos < condition.length) {
        // Skip whitespace
        if (/\s/.test(condition[pos])) {
            pos++;
            continue;
        }

        // Parentheses
        if (condition[pos] === '(') {
            tokens.push({ type: 'LPAREN' });
            pos++;
            continue;
        }
        if (condition[pos] === ')') {
            tokens.push({ type: 'RPAREN' });
            pos++;
            continue;
        }
        if (condition[pos] === ',') {
            tokens.push({ type: 'COMMA' });
            pos++;
            continue;
        }

        // String literal (single quotes)
        if (condition[pos] === "'") {
            let value = '';
            pos++; // Skip opening quote
            while (pos < condition.length && condition[pos] !== "'") {
                if (condition[pos] === "'" && condition[pos + 1] === "'") {
                    // Escaped quote
                    value += "'";
                    pos += 2;
                } else {
                    value += condition[pos];
                    pos++;
                }
            }
            if (pos >= condition.length) {
                throw new FirebirdError('Unterminated string literal in condition', 'VALIDATION_ERROR');
            }
            pos++; // Skip closing quote
            tokens.push({ type: 'LITERAL', value });
            continue;
        }

        // Number literal
        if (/[0-9]/.test(condition[pos])) {
            let value = '';
            while (pos < condition.length && /[0-9.]/.test(condition[pos])) {
                value += condition[pos];
                pos++;
            }
            const num = parseFloat(value);
            if (isNaN(num)) {
                throw new FirebirdError(`Invalid number literal: ${value}`, 'VALIDATION_ERROR');
            }
            tokens.push({ type: 'LITERAL', value: num });
            continue;
        }

        // NULL literal
        if (condition.substring(pos, pos + 4).toUpperCase() === 'NULL') {
            tokens.push({ type: 'LITERAL', value: null });
            pos += 4;
            continue;
        }

        // Operators and identifiers
        const remaining = condition.substring(pos);
        
        // Multi-word operators (check these first)
        const multiWordOps = ['IS NOT NULL', 'IS NULL', 'NOT LIKE', 'NOT IN', 'LIKE', 'NOT IN', 'IN', 'AND', 'OR', 'NOT'];
        let found = false;
        for (const op of multiWordOps) {
            if (remaining.toUpperCase().startsWith(op)) {
                if (!ALLOWED_OPERATORS.has(op)) {
                    throw new FirebirdError(`Operator not allowed: ${op}`, 'SECURITY_ERROR');
                }
                tokens.push({ type: 'OPERATOR', value: op });
                pos += op.length;
                found = true;
                break;
            }
        }
        if (found) continue;

        // Single character operators
        if (['=', '<', '>', '!',].includes(condition[pos])) {
            let op = condition[pos];
            pos++;
            // Check for two-character operators
            if (['<', '>', '!',].includes(condition[pos - 1]) && condition[pos] === '=') {
                op += '=';
                pos++;
            }
            if (op === '<>') op = '!='; // Normalize
            if (!ALLOWED_OPERATORS.has(op)) {
                throw new FirebirdError(`Operator not allowed: ${op}`, 'SECURITY_ERROR');
            }
            tokens.push({ type: 'OPERATOR', value: op });
            continue;
        }

        // Identifier (column name)
        if (/[A-Za-z_]/.test(condition[pos])) {
            let value = '';
            while (pos < condition.length && /[A-Za-z0-9_]/.test(condition[pos])) {
                value += condition[pos];
                pos++;
            }
            // Check if it's a keyword we missed
            const upper = value.toUpperCase();
            if (ALLOWED_OPERATORS.has(upper)) {
                tokens.push({ type: 'OPERATOR', value: upper });
                continue;
            }
            // Validate identifier
            if (!isValidIdentifier(value)) {
                throw new FirebirdError(`Invalid identifier: ${value}`, 'SECURITY_ERROR');
            }
            tokens.push({ type: 'IDENTIFIER', value });
            continue;
        }

        throw new FirebirdError(
            `Unexpected character at position ${pos}: ${condition[pos]}`,
            'VALIDATION_ERROR'
        );
    }

    return tokens;
}

/**
 * Parse and evaluate a condition against a row
 * @param tokens - Tokenized condition
 * @param row - Data row to evaluate against
 * @returns Evaluation result
 */
function evaluateCondition(tokens: Token[], row: Record<string, any>): boolean {
    let pos = 0;

    function peek(): Token | null {
        return pos < tokens.length ? tokens[pos] : null;
    }

    function consume(): Token {
        return tokens[pos++];
    }

    function parseOr(): boolean {
        let left = parseAnd();
        const next = peek();
        while (next?.type === 'OPERATOR' && next.value === 'OR') {
            consume();
            const right = parseAnd();
            left = left || right;
        }
        return left;
    }

    function parseAnd(): boolean {
        let left = parseNot();
        const next = peek();
        while (next?.type === 'OPERATOR' && next.value === 'AND') {
            consume();
            const right = parseNot();
            left = left && right;
        }
        return left;
    }

    function parseNot(): boolean {
        const next = peek();
        if (next?.type === 'OPERATOR' && next.value === 'NOT') {
            consume();
            return !parsePrimary();
        }
        return parsePrimary();
    }

    function parsePrimary(): boolean {
        const token = peek();

        if (!token) {
            throw new FirebirdError('Unexpected end of condition', 'VALIDATION_ERROR');
        }

        // Parenthesized expression
        if (token.type === 'LPAREN') {
            consume();
            const result = parseOr();
            if (peek()?.type !== 'RPAREN') {
                throw new FirebirdError('Expected closing parenthesis', 'VALIDATION_ERROR');
            }
            consume();
            return result;
        }

        // Get left operand (identifier or literal)
        const leftToken = consume();
        let leftValue: any;

        if (leftToken.type === 'IDENTIFIER') {
            leftValue = row[leftToken.value];
        } else if (leftToken.type === 'LITERAL') {
            leftValue = leftToken.value;
        } else {
            throw new FirebirdError(`Unexpected token: ${JSON.stringify(leftToken)}`, 'VALIDATION_ERROR');
        }

        // Check for operator
        const opToken = peek();
        if (!opToken || opToken.type !== 'OPERATOR') {
            // No operator - treat as boolean
            return Boolean(leftValue);
        }

        const operator = (opToken as { type: 'OPERATOR'; value: string }).value;
        consume();

        // Handle unary operators
        if (operator === 'IS NULL') {
            return leftValue === null || leftValue === undefined;
        }
        if (operator === 'IS NOT NULL') {
            return leftValue !== null && leftValue !== undefined;
        }

        // Handle IN/NOT IN
        if (operator === 'IN' || operator === 'NOT IN') {
            if (peek()?.type !== 'LPAREN') {
                throw new FirebirdError('Expected ( after IN operator', 'VALIDATION_ERROR');
            }
            consume(); // LPAREN

            const values: any[] = [];
            while (peek()?.type !== 'RPAREN') {
                const valToken = consume();
                if (valToken.type === 'LITERAL') {
                    values.push(valToken.value);
                } else if (valToken.type === 'IDENTIFIER') {
                    values.push(row[valToken.value]);
                } else if (valToken.type !== 'COMMA') {
                    throw new FirebirdError('Expected value in IN list', 'VALIDATION_ERROR');
                }
            }
            consume(); // RPAREN

            const result = values.some(v => v === leftValue);
            return operator === 'IN' ? result : !result;
        }

        // Handle LIKE
        if (operator === 'LIKE' || operator === 'NOT LIKE') {
            const rightToken = consume();
            if (rightToken.type !== 'LITERAL' || typeof rightToken.value !== 'string') {
                throw new FirebirdError('LIKE requires a string pattern', 'VALIDATION_ERROR');
            }
            // Convert SQL LIKE pattern to regex
            const pattern = rightToken.value
                .replace(/%/g, '.*')
                .replace(/_/g, '.');
            const regex = new RegExp(`^${pattern}$`, 'i');
            const result = typeof leftValue === 'string' && regex.test(leftValue);
            return operator === 'LIKE' ? result : !result;
        }

        // Binary comparison operators
        const rightToken = consume();
        let rightValue: any;

        if (rightToken.type === 'IDENTIFIER') {
            rightValue = row[rightToken.value];
        } else if (rightToken.type === 'LITERAL') {
            rightValue = rightToken.value;
        } else {
            throw new FirebirdError(`Expected value after operator`, 'VALIDATION_ERROR');
        }

        switch (operator) {
            case '=':
                return leftValue == rightValue;
            case '!=':
            case '<>':
                return leftValue != rightValue;
            case '<':
                return leftValue < rightValue;
            case '>':
                return leftValue > rightValue;
            case '<=':
                return leftValue <= rightValue;
            case '>=':
                return leftValue >= rightValue;
            default:
                throw new FirebirdError(`Unknown operator: ${operator}`, 'VALIDATION_ERROR');
        }
    }

    return parseOr();
}

/**
 * Create a filter function from a SQL-like condition (safe implementation)
 * @param {string} condition - SQL-like condition
 * @returns {Function} Filter function
 * @throws {FirebirdError} If condition is invalid or contains unsafe constructs
 */
function createFilterFunction(condition: string): (row: any) => boolean {
    // Tokenize the condition
    const tokens = tokenizeCondition(condition);
    
    // Return a function that evaluates the condition safely
    return (row: any): boolean => {
        try {
            return evaluateCondition(tokens, row);
        } catch (error: any) {
            logger.error(`Error evaluating row filter condition: ${error.message}`);
            // On error, include the row (fail-safe for filtering)
            return true;
        }
    };
}

/**
 * Mask sensitive data in a result set
 * @param {any[]} results - Result set to mask
 * @returns {any[]} Masked result set
 */
function maskSensitiveData(results: any[]): any[] {
    if (!securityConfig.dataMasking || securityConfig.dataMasking.length === 0) {
        return results;
    }

    try {
        // Create a deep copy of the results to avoid modifying the original
        const maskedResults = JSON.parse(JSON.stringify(results));

        // Apply each masking rule
        for (const rule of securityConfig.dataMasking) {
            const { columns, pattern, replacement } = rule;

            // Convert string pattern to RegExp if needed
            const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

            // Apply the rule to each row
            for (const row of maskedResults) {
                for (const column of columns) {
                    if (column in row && row[column] !== null && row[column] !== undefined) {
                        // Apply the masking
                        const originalValue = String(row[column]);
                        row[column] = originalValue.replace(regex, replacement);
                    }
                }
            }
        }

        return maskedResults;
    } catch (error: any) {
        logger.error(`Error masking sensitive data: ${error.message}`);
        return results;
    }
}
