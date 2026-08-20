/**
 * FactLog repository — append-only, so NO soft-delete plugin (nothing is ever
 * removed). Just the method registry + mongo operations.
 */
import { methodRegistryPlugin, mongoOperationsPlugin, Repository } from '@classytic/mongokit';
import type { FactLogDocument } from './fact-log.model.js';
import FactLog from './fact-log.model.js';

class FactLogRepository extends Repository<FactLogDocument> {
  constructor() {
    super(FactLog, [methodRegistryPlugin(), mongoOperationsPlugin()]);
  }
}

const factLogRepository = new FactLogRepository();
export default factLogRepository;
export { FactLogRepository };
