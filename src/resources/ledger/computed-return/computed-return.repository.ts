/**
 * ComputedReturn repository — a cache, so hard-delete is fine (no soft-delete).
 */
import { methodRegistryPlugin, mongoOperationsPlugin, Repository } from '@classytic/mongokit';
import type { ComputedReturnDocument } from './computed-return.model.js';
import ComputedReturn from './computed-return.model.js';

class ComputedReturnRepository extends Repository<ComputedReturnDocument> {
  constructor() {
    super(ComputedReturn, [methodRegistryPlugin(), mongoOperationsPlugin()]);
  }
}

const computedReturnRepository = new ComputedReturnRepository();
export default computedReturnRepository;
export { ComputedReturnRepository };
