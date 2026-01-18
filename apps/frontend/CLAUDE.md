# CLAUDE.md - Frontend Context

> **Note for AI Assistants**: Frontend-specific context for **sardeenz**. For project overview, see root [CLAUDE.md](../../CLAUDE.md). For backend context, see [backend/CLAUDE.md](../backend/CLAUDE.md).

## Frontend Overview

React 18 admin dashboard for managing multiple vLLM model instances on shared GPU infrastructure.

**Technology Stack**: React 18.3+, PatternFly 6.x, React Router 7, TypeScript 5.7+, Vite 6.0+

**Development**: Port 5173 with Vite HMR
**Production**: Built and served statically by Fastify backend on port 3000

**Detailed Architecture**: See [Frontend Architecture](../../docs/architecture/frontend-architecture.md) for component specs, state management, and API integration.

## PatternFly 6 Critical Requirements

### Context7 Warning

**DO NOT use Context7 for PatternFly components.** Context7 may contain outdated PatternFly versions.

**Instead use:**

- Local guide: `docs/development/pf6-guide/`
- Official docs: PatternFly.org

Context7 is fine for: React, Axios, React Router, Vitest, and other non-PatternFly libraries.

### Essential Rules

1. **Class Prefix**: ALL PatternFly classes MUST use `pf-v6-` prefix
2. **Design Tokens**: Use semantic tokens (`--pf-t--`) only, never hardcode colors
3. **Component Import**: Import from `@patternfly/react-core` v6
4. **Theme Testing**: Test in both light and dark themes

**For complete styling and token guidance**, see [Styling Standards](../../docs/development/pf6-guide/guidelines/styling-standards.md).

## Development Commands

```bash
npm run dev              # Development server with HMR
npm run build            # TypeScript check + Vite production build
npm run test             # Run Vitest tests
npm run test:coverage    # Coverage report
npm run lint             # ESLint check
npm run type-check       # TypeScript type checking
npm run format           # Prettier format
```

## Project Structure

```
frontend/
├── src/
│   ├── components/      # Shared UI components
│   │   ├── benchmark/   # Benchmark-related components
│   │   ├── inference/   # Chat session and inference components
│   │   ├── Layout/      # AppLayout, NavSidebar
│   │   ├── LoadConfigurationDialog.tsx   # Load saved model configurations
│   │   ├── SaveConfigurationDialog.tsx   # Save current models as configuration
│   │   ├── LoadModelDialog.tsx           # Load individual models
│   │   └── ProtectedRoute.tsx            # Auth-based route guard
│   ├── contexts/        # React Context providers
│   │   ├── AuthContext.tsx           # Authentication state management
│   │   ├── NotificationContext.tsx   # Toast notifications
│   │   └── ConnectionContext.tsx     # Backend connection status
│   ├── pages/           # Route-specific pages
│   │   ├── Login.tsx         # Login page (simple & OAuth modes)
│   │   ├── OAuthCallback.tsx # OAuth redirect handler
│   │   └── ...
│   ├── services/        # API client layer
│   ├── App.tsx          # Root component with routing
│   └── main.tsx         # Entry point
├── dist/                # Vite build output
└── vite.config.ts       # Vite configuration
```

## Key Rules

### DO

- Use PatternFly 6 components with `pf-v6-` prefix
- Import from `@patternfly/react-core`, `@patternfly/react-table`, `@patternfly/react-icons` v6
- Use `--pf-t--` semantic design tokens for styling
- Use `useState` for local state, Context API for auth/global state
- Use Vitest for testing (NOT Jest)
- Handle errors with try/catch and PatternFly Alert components
- Include ARIA labels and accessibility features
- Run `npm run format` after creating or modifying files

### DON'T

- Use PatternFly 5 or hardcoded `pf-` classes (must be `pf-v6-`)
- Use hardcoded colors, sizes, or spacing (use `--pf-t--` tokens)
- Use legacy `--pf-v6-global--` tokens (use semantic `--pf-t--` tokens)
- Use Webpack (project uses Vite)
- Use Jest (project uses Vitest)
- Store JWT in localStorage (security risk)
- Hardcode API URLs (use environment variables)

## Known Limitations

- No internationalization (i18n) - English only for MVP
- No offline support or service worker
- No WebSocket implementation (polling only)
- Limited error recovery (manual refresh for some errors)
- No undo/redo for model operations
- No bulk operations (load/unload multiple models at once)

## Related Documentation

- [Frontend Architecture](../../docs/architecture/frontend-architecture.md) - Component specs, state management, API integration
- [PatternFly 6 Guide](../../docs/development/pf6-guide/README.md) - Complete UI development guide
  - [Styling Standards](../../docs/development/pf6-guide/guidelines/styling-standards.md)
  - [Testing Patterns](../../docs/development/pf6-guide/testing-patterns/README.md)
  - [Troubleshooting](../../docs/development/pf6-guide/troubleshooting/README.md)
- [Frontend API Client](../../docs/development/frontend-api-client.md) - Controller API integration
- Root [CLAUDE.md](../../CLAUDE.md) - Project overview
- Backend [CLAUDE.md](../backend/CLAUDE.md) - Backend API context
