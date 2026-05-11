import { MCPConfig, MCPQuery } from '../types.js';

export function validateConfig(config: MCPConfig): MCPConfig {
  if (!config.host) {
    throw new Error('Host is required');
  }
  if (!config.port) {
    throw new Error('Port is required');
  }
  if (!config.database) {
    throw new Error('Database path is required');
  }
  if (!config.user) {
    throw new Error('User is required');
  }
  if (!config.password) {
    throw new Error('Password is required');
  }
  return config;
}

export function sanitizeInput<T>(input: T): T {
  if (typeof input === 'string') {
    return input.trim() as T;
  }
  if (Array.isArray(input)) {
    return input.map(item => sanitizeInput(item)) as T;
  }
  if (typeof input === 'object' && input !== null) {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, sanitizeInput(value)])
    ) as T;
  }
  return input;
}

export function validateQuery(query: MCPQuery): MCPQuery {
  if (!query.sql) {
    throw new Error('SQL query is required');
  }
  return {
    sql: query.sql.trim(),
    params: query.params?.map(param => sanitizeInput(param)),
    context: query.context ? {
      description: query.context.description?.trim(),
      constraints: query.context.constraints?.map(c => c.trim()),
      preferences: query.context.preferences?.map(p => p.trim())
    } : undefined
  };
}

/** Maximum SQL query size (100 KB) */
const MAX_SQL_SIZE = 100 * 1024;

/** Maximum identifier length */
const MAX_IDENTIFIER_LENGTH = 128;

/**
 * Validates an identifier (table/column name) to prevent SQL injection
 * @param name - Identifier to validate
 * @returns true if valid, false otherwise
 */
export function isValidIdentifier(name: string): boolean {
  if (!name || name.length === 0 || name.length > MAX_IDENTIFIER_LENGTH) {
    return false;
  }
  // Allow alphanumeric, underscores, and must start with letter or underscore
  // Also allow quoted identifiers with double quotes
  if (name.startsWith('"') && name.endsWith('"')) {
    const inner = name.slice(1, -1);
    return inner.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(inner);
  }
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/**
 * Valida una consulta SQL o nombre de tabla/campo para prevenir inyección SQL
 * @param sql Consulta SQL o nombre de tabla/campo a validar
 * @returns true si es válido, false si es potencialmente peligroso
 */
export function validateSql(sql: string): boolean {
  if (!sql) return false;
  
  // Size limit check
  if (sql.length > MAX_SQL_SIZE) {
    return false;
  }
  
  const sanitized = sql.trim();
  
  // Phase 1.3: Dangerous patterns - block WITHOUT requiring semicolon prefix
  // These patterns are dangerous in any context
  const dangerousPatterns = [
    // DDL/DML operations (can be chained without semicolon in some contexts)
    /\bDROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW|PROCEDURE|TRIGGER|SEQUENCE|DOMAIN|EXCEPTION|FILTER|FUNCTION|PACKAGE|ROLE|GENERATOR)\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bUPDATE\s+\w+\s+SET\b/i,
    /\bINSERT\s+INTO\b/i,
    /\bALTER\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW|PROCEDURE|TRIGGER|SEQUENCE|DOMAIN|EXCEPTION|FILTER|FUNCTION|PACKAGE|ROLE|GENERATOR)\b/i,
    /\bCREATE\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW|PROCEDURE|TRIGGER|SEQUENCE|DOMAIN|EXCEPTION|FILTER|FUNCTION|PACKAGE|ROLE|GENERATOR)\b/i,
    /\bTRUNCATE\s+(TABLE)?\b/i,
    /\bGRANT\s+/i,
    /\bREVOKE\s+/i,
    
    // SQL injection patterns
    /\bUNION\s+(ALL\s+)?SELECT\b/i,
    /\bUNION\s+DISTINCT\s+SELECT\b/i,
    
    // Comments (used to bypass validation)
    /--/,
    /\/\*/,
    /\*\//,
    
    // Dangerous procedures/functions
    /\bxp_cmdshell\b/i,
    /\bexec\s+master\b/i,
    /\bexec\s+xp_/i,
    /\bsp_\w+/i,
    
    // File operations
    /\bINTO\s+OUTFILE\b/i,
    /\bINTO\s+DUMPFILE\b/i,
    /\bLOAD_FILE\b/i,
    
    // Information schema access (often used in injection attacks)
    /\binformation_schema\b/i,
    /\bsys\.(tables|columns|objects)\b/i,
    
    // Boolean-based blind injection patterns
    /\bOR\s+1\s*=\s*1\b/i,
    /\bOR\s+'[^']*'\s*=\s*'[^']*'/i,
    /\bAND\s+1\s*=\s*1\b/i,
    
    // Time-based injection patterns
    /\bWAITFOR\s+DELAY\b/i,
    /\bBENCHMARK\s*\(/i,
    /\bSLEEP\s*\(/i,
    /\bPG_SLEEP\s*\(/i,
    
    // Stacked queries indicator
    /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i,
    
    // Hex encoding (used to bypass filters)
    /0x[0-9a-fA-F]+\s*\(/i,
    
    // Char encoding bypass
    /\bCHAR\s*\(\s*\d+\s*\)/i,
    
    // Concatenation injection
    /\bCONCAT\s*\(\s*['"]\s*\)/i,
  ];
  
  // Verificamos si la consulta contiene patrones peligrosos
  for (const pattern of dangerousPatterns) {
    if (pattern.test(sanitized)) {
      return false;
    }
  }
  
  // Verificar el balance de comillas y paréntesis para consultas completas
  // Solo para consultas, no para nombres de tablas/campos
  const lowerSanitized = sanitized.toLowerCase();
  if (lowerSanitized.startsWith('select') || 
      lowerSanitized.startsWith('update') || 
      lowerSanitized.startsWith('delete') || 
      lowerSanitized.startsWith('insert') ||
      lowerSanitized.startsWith('execute') ||
      lowerSanitized.startsWith('exec')) {
    
    const singleQuotes = (sanitized.match(/'/g) || []).length;
    const doubleQuotes = (sanitized.match(/"/g) || []).length;
    const openParens = (sanitized.match(/\(/g) || []).length;
    const closeParens = (sanitized.match(/\)/g) || []).length;
    
    // Verificar que las comillas y paréntesis estén balanceados
    if (singleQuotes % 2 !== 0 || 
        doubleQuotes % 2 !== 0 || 
        openParens !== closeParens) {
      return false;
    }
  }
  
  return true;
}