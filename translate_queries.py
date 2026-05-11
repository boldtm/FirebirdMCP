#!/usr/bin/env python3
"""Translate Spanish text to English in queries.ts"""
import os

os.chdir('/home/boldtm/develop/FirebirdMCP')

with open('src/db/queries.ts', 'r', encoding='utf-8') as f:
    content = f.read()

translations = {
    'Obtiene la estructura detallada de una tabla específica': 'Gets the detailed structure of a specific table',
    'Nombre de la tabla': 'Table name',
    'Configuración de conexión a la base de datos (opcional)': 'Database connection configuration (optional)',
    'Array de objetos con información detallada de cada columna': 'Array of objects with detailed column information',
    'Si hay un error de conexión, de consulta o el nombre de tabla es inválido': 'If there is a connection error, query error, or invalid table name',
    'Obteniendo estructura de la tabla: ': 'Getting table structure for: ',
    'Nombre de tabla inválido: ': 'Invalid table name: ',
    '// Consulta para obtener información de las columnas': '// Query to get column information',
    'No se encontraron columnas para la tabla: ': 'No columns found for table: ',
    '. Es posible que la tabla no exista.': '. The table may not exist.',
    'columnas para la tabla: ': 'columns for table: ',
    'Error describiendo la tabla ': 'Error describing table ',
    'Obtiene una lista de todas las tablas en la base de datos': 'Gets a list of all tables in the database',
    'Array de nombres de tablas': 'Array of table names',
    'Obteniendo lista de tablas de usuario': 'Getting list of user tables',
    '// Firebird puede devolver nombres con espacios al final, así que hacemos trim': '// Firebird may return names with trailing spaces, so trim them',
    'tablas de usuario': 'user tables',
    'Error al listar tablas: ': 'Error listing tables: ',
    '// Propagar el error si ya es un FirebirdError': '// Propagate the error if it is already a FirebirdError',
}

for old, new in translations.items():
    if old in content:
        content = content.replace(old, new)
        print(f'Replaced: {old[:50]}...')
    else:
        print(f'NOT FOUND: {old[:50]}...')

with open('src/db/queries.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done with queries.ts')