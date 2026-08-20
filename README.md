# server

Built with [Arc](https://github.com/classytic/arc) - Resource-Oriented Backend Framework

## Quick Start

```bash
# Install dependencies
npm install

# Start development server (uses .env.dev)
npm run dev

# Run tests
npm test
```

## Project Structure

```
src/
├── config/                  # Configuration (loaded first)
│   ├── env.ts              # Env loader (import first!)
│   └── index.ts            # App config
├── shared/                  # Shared utilities
│   ├── adapter.ts          # MongoKit adapter factory
│   ├── permissions.ts      # Permission helpers
│   └── presets/             # Multi-tenant presets
├── plugins/                 # App-specific plugins
│   └── index.ts            # Plugin registry
├── resources/               # API Resources
│   ├── index.ts            # Resource registry
│   └── example/             # Example resource
│       ├── index.ts        # Resource definition
│       ├── model.ts        # Mongoose schema
│       └── repository.ts   # MongoKit repository
├── app.ts                  # App factory (reusable)
└── index.ts                # Server entry point
tests/
└── example.test.ts         # Example tests
```

## Architecture

### Entry Points

- **`src/index.ts`** - HTTP server entry point
- **`src/app.ts`** - App factory (import for workers/tests)

```typescript
// For workers or custom entry points:
import { createAppInstance } from './app.js';

const app = await createAppInstance();
// Use app for your worker logic
```

### Adding Resources

1. Create a new folder in `src/resources/`:

```
src/resources/product/
├── index.ts      # Resource definition
├── model.ts      # Mongoose schema
└── repository.ts # MongoKit repository
```

2. Register in `src/resources/index.ts`:

```typescript
import productResource from './product/index.js';

export const resources = [
  exampleResource,
  productResource,  // Add here
];
```

### Adding Plugins

Add custom plugins in `src/plugins/index.ts`:

```typescript
export async function registerPlugins(app, deps) {
  const { config } = deps;  // Explicit dependency injection

  await app.register(myCustomPlugin, { ...options });
}
```

## CLI Commands

```bash
# Generate a new resource
arc generate resource product

# Introspect existing schema
arc introspect

# Generate API docs
arc docs
```

## Environment Files (Next.js-style)

Priority (first loaded wins):
1. `.env.local` — Machine-specific overrides (gitignored)
2. `.env.{environment}` — e.g., `.env.production`, `.env.development`, `.env.test`
3. `.env` — Shared defaults (fallback)

Short forms also supported: `.env.prod`, `.env.dev`, `.env.test`

## API Documentation

API documentation is available via Scalar UI:

- **Interactive UI**: [http://localhost:8040/docs](http://localhost:8040/data)
- **OpenAPI Spec**: [http://localhost:8040/_docs/openapi.json](http://localhost:8040/_docs/openapi.json)

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /docs | API documentation (Scalar UI) |
| GET | /_docs/openapi.json | OpenAPI 3.0 spec |
| GET | /examples | List all |
| GET | /examples/:id | Get by ID |
| POST | /examples | Create |
| PATCH | /examples/:id | Update |
| DELETE | /examples/:id | Delete |

## Docker Deployment

This project comes ready for containerization:

```bash
# Build the production image
docker build -t server .

# Run the container
docker run -p 8040:8040 --env-file .env server
```

If you're using a database (like MongoDB), you can use Docker Compose to spin up the full stack locally:

```bash
docker-compose up -d
```
