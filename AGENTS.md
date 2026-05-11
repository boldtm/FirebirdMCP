# AGENTS.md — MCP Firebird

Guidance for coding agents (Copilot, Cursor, Cascade, etc.) working in this repository.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5 (strict mode, ES2020 target) |
| Module system | ESM (`"type": "module"`, NodeNext resolution) |
| Runtime | Node.js ≥ 20 |
| MCP SDK | `@modelcontextprotocol/sdk` ^1.13.2 |
| Database driver (default) | `node-firebird` ^1.1.5 (pure JS, no wire encryption) |
| Database driver (optional) | `node-firebird-driver-native` ^3.2.2 (wire encryption support) |
| Schema validation | `zod` + `zod-to-json-schema` |
| HTTP framework | Express 4 |
| Logging | Winston (`src/utils/logger.ts`) |
| Testing | Jest 29 + `ts-jest` + Supertest |
| Linting | ESLint + `@typescript-eslint` |
| Build | `tsc -p tsconfig.build.json` → `dist/` |
| Containerisation | Docker / `docker-compose.yml` |
| Cloud deployment | Smithery (`smithery.yaml`, `smithery.config.js`) |

---

## Repository Layout

```
src/
  cli.ts               — CLI entry point (minimist arg parsing, env setup)
  index.ts             — Main STDIO entry; selects modern vs. legacy server
  smithery.ts          — Smithery cloud entry
  smithery-entry.ts    — Streamable-HTTP entry for Smithery
  http-entry.ts        — Unified HTTP server entry

  server/
    mcp-server.ts      — Modern McpServer (registerTool / registerPrompt / registerResource)
    create-server.ts   — Legacy Server (setRequestHandler) — kept for back-compat
    index.ts           — Legacy server bootstrap
    index-mcp.ts       — Modern server bootstrap
    unified-server.ts  — Runs SSE + Streamable-HTTP simultaneously
    sse.ts             — SSE transport implementation
    streamable-http.ts — Streamable-HTTP transport implementation
    config.ts          — Server config (ports, timeouts, CORS, …)

  db/
    connection.ts      — Firebird connection pool management
    driver-factory.ts  — Selects pure-JS or native driver at runtime
    queries.ts         — All SQL execution helpers
    schema.ts          — Schema introspection helpers
    management.ts      — Backup / restore / validate
    wrapped-queries.ts — Thin wrappers used by tools
    wrapper.ts         — Promise wrappers around node-firebird callbacks

  tools/
    database.ts        — Query, performance, backup/restore/validate tools + Zod schemas
    metadata.ts        — Schema introspection tools
    simple.ts          — Utility tools (ping, version, …)

  prompts/
    database.ts        — Database-oriented prompt definitions
    sql.ts             — SQL-oriented prompt definitions
    templates.ts       — General prompt templates
    advanced-templates.ts — Advanced prompt templates
    types.ts           — PromptDefinition type

  resources/
    database.ts        — MCP resource definitions (tables, schema, …)

  security/
    config.ts          — SecurityConfig Zod schema + loader
    authorization.ts   — none / basic / OAuth2 authorization middleware
    audit.ts           — Query audit logging (file or database)
    dataMasking.ts     — Column-level data masking
    resourceLimits.ts  — Rate limiting, max-rows, response-size guards
    index.ts           — initSecurity() façade

  types/               — Shared TypeScript types
  types.ts             — Top-level shared types

  utils/
    logger.ts          — Winston logger factory (createLogger)
    errors.ts          — FirebirdError / MCPError typed error classes
    jsonHelper.ts      — stringifyCompact / wrapSuccess / wrapError / formatForClaude
    security.ts        — validateSql (SQL injection / DML guard)
    session-manager.ts — SSE/HTTP session lifecycle
    stdout-guard.ts    — Prevents accidental stdout writes in STDIO mode
    firebird-tools.ts  — gbak / nbackup shell helpers

docs/                  — Extended markdown documentation
examples/              — Client usage examples
```

---

## Key Architectural Approaches

### Transport Abstraction
Three transport modes share the same MCP server core:
- **STDIO** — default for Claude Desktop / local clients.
- **SSE** (`/sse` + `/messages`) — legacy SSE-based MCP transport.
- **Streamable HTTP** (`/mcp`) — modern MCP 2025-03-26 bidirectional transport.
- **Unified** — runs SSE and Streamable HTTP in a single Express process with automatic protocol detection (`/mcp-auto`).

Entry points (`index.ts`, `http-entry.ts`, `smithery-entry.ts`, `smithery.ts`) wire a transport to the same server logic.

### Modern vs. Legacy Server
- **Modern** (`server/mcp-server.ts`): uses `McpServer` with `registerTool()`, `registerPrompt()`, `registerResource()`. **Default** (`USE_LEGACY_SERVER !== 'true'`).
- **Legacy** (`server/create-server.ts`): uses raw `Server` with `setRequestHandler`. Kept only for backward compatibility. Do not add new features here.

### Dual Driver Strategy
`src/db/driver-factory.ts` checks for `node-firebird-driver-native` at runtime and falls back to `node-firebird`. Use the `--use-native-driver` CLI flag or `USE_NATIVE_DRIVER=true` env var to opt in. Never hard-code a specific driver import in tool or query code.

### Zod-First Schema Design
Every tool argument object is defined as a named `z.object(…)` export in `src/tools/`. These schemas are the single source of truth for:
- MCP tool input validation.
- JSON Schema generation via `zod-to-json-schema` (sent to the client as `inputSchema`).
- TypeScript parameter types (inferred via `z.infer<>`).

Add new tools by: (1) defining a Zod schema export, (2) implementing the handler, (3) calling `server.registerTool()` inside `mcp-server.ts` (modern path) or adding a handler in `create-server.ts` (legacy path, avoid).

### Security Layers (applied in order)
1. `validateSql` — blocks dangerous DML/DDL patterns before execution.
2. `authorization.ts` — optional HTTP bearer / OAuth2 token check.
3. `resourceLimits.ts` — enforces `maxRowsPerQuery`, `maxResponseSize`, rate limits.
4. `dataMasking.ts` — masks configured columns before returning results.
5. `audit.ts` — records queries to file or database table.

Security is initialised once at startup via `initSecurity()`.

### Session Management
`src/utils/session-manager.ts` tracks live SSE/HTTP sessions. Configurable via env vars:
- `SSE_SESSION_TIMEOUT_MS` (default 30 min)
- `MAX_SESSIONS` (default 1000)
- `SESSION_CLEANUP_INTERVAL_MS` (default 60 s)

### Error Handling
Use typed error classes from `src/utils/errors.ts`:
- `FirebirdError(message, code, cause)` — database-level errors.
- `MCPError(message, type, context, originalError)` — protocol-level errors.

Always return `wrapError()` from `src/utils/jsonHelper.ts` in tool handlers rather than throwing untyped objects.

---

## Base Feature Set (MCP Tools)

| Tool | Description |
|---|---|
| `execute_query` | Execute a parameterised Firebird SQL query |
| `list_tables` | List all user tables in the database |
| `describe_table` | Column definitions, constraints, indexes for a table |
| `get_field_descriptions` | Metadata descriptions for table columns |
| `analyze_query_performance` | Run query N times and return timing statistics |
| `get_execution_plan` | Return Firebird's query execution plan |
| `analyze_missing_indexes` | Suggest indexes for a given query |
| `execute_batch_queries` | Execute multiple queries in one call |
| `describe_batch_tables` | Describe multiple tables in one call |
| `backup_database` | gbak / nbackup database backup |
| `restore_database` | Restore from a gbak backup |
| `validate_database` | Check data and index integrity |

## Base Feature Set (MCP Resources)

Dynamic URI-addressed resources expose live database metadata (table list, table schema, column info) that MCP clients can subscribe to.

## Base Feature Set (MCP Prompts)

Pre-built prompt templates for:
- Database exploration and schema analysis.
- SQL query writing and optimisation.
- Performance tuning guidance.
- Advanced multi-step workflows.

---

## Development Commands

```bash
# Install dependencies
npm install

# Build (production, no test files)
npm run build

# Build (development, includes test declarations)
npm run build:dev

# Start built server
npm start

# Watch mode (rebuild + restart on source changes)
npm run dev

# Run all tests
npm test

# Lint
npm run lint

# Run MCP Inspector (interactive debugging UI)
npm run inspector
```

### Environment Variables

Copy `.env.example` to `.env`. Key variables:

| Variable | Purpose |
|---|---|
| `FIREBIRD_HOST` | Firebird server host |
| `FIREBIRD_PORT` | Firebird port (default 3050) |
| `FIREBIRD_DATABASE` | Absolute path to `.fdb` file |
| `FIREBIRD_USER` | Database user |
| `FIREBIRD_PASSWORD` | Database password |
| `TRANSPORT_TYPE` | `stdio` \| `sse` \| `http` \| `unified` |
| `SSE_PORT` / `HTTP_PORT` | Listening port for HTTP transports |
| `USE_NATIVE_DRIVER` | `true` to enable wire encryption via native driver |
| `USE_LEGACY_SERVER` | `true` to use legacy `Server` implementation |
| `LOG_LEVEL` | Winston log level (`debug`, `info`, `warn`, `error`) |
| `MCP_LOG_FILE` | Path to write log output |

---

## Testing Conventions

- Tests live in `src/__tests__/` and match `**/__tests__/**/*.test.{ts,js}`.
- Use `jest.integration.config.js` for integration tests that require a live Firebird instance.
- Mock the `node-firebird` driver in unit tests; do not rely on a real database connection.
- Use `supertest` for HTTP transport endpoint testing.
- Coverage is collected from all `src/**/*.ts` excluding test and declaration files.

---

## Code Style Rules

- **No `require()`** — this is a pure ESM package; all imports use `import … from '…'`.
- **File extensions in imports** — always use `.js` extension in import paths (NodeNext resolution).
- **Strict TypeScript** — `strict: true`; no implicit `any`.
- **Avoid stdout in STDIO mode** — all logging must go through Winston (stderr). The `stdout-guard.ts` utility enforces this; do not bypass it.
- **Parameterised queries** — never concatenate user input into SQL strings; always use the `params` array.
- **No new features in legacy server** — extend `mcp-server.ts` only.
