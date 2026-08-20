/**
 * MongoKit Adapter Factory
 *
 * Creates Arc adapters using MongoKit repositories.
 * The repository handles query parsing via MongoKit's built-in QueryParser.
 */

import type { Repository } from '@classytic/mongokit';
import { buildCrudSchemasFromModel } from '@classytic/mongokit';
import { createMongooseAdapter } from '@classytic/mongokit/adapter';
import type { DataAdapter } from '@classytic/repo-core/adapter';
import type { Model } from 'mongoose';

/**
 * Create a MongoKit-powered adapter for a resource.
 *
 * Note: Query parsing is handled by MongoKit's Repository class.
 * `buildCrudSchemasFromModel` is the canonical OpenAPI schema generator
 * for arc + Mongoose (arc 2.12+ no longer ships a built-in fallback —
 * passing it explicitly is required for OpenAPI auto-generation).
 */
export function createAdapter<TDoc = unknown>(
  model: Model<TDoc>,
  repository: Repository<TDoc>,
): DataAdapter<TDoc> {
  // Explicit return type keeps the declaration portable — under pnpm's
  // non-hoisted layout the inferred type references mongokit's internal
  // paths and tsc fails with TS2742/TS2883.
  return createMongooseAdapter({
    model,
    repository,
    schemaGenerator: buildCrudSchemasFromModel,
  });
}
