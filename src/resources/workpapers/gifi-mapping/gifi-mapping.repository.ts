/**
 * GifiMapping repository
 */
import { methodRegistryPlugin, mongoOperationsPlugin, Repository } from '@classytic/mongokit';
import type { GifiMappingDocument } from './gifi-mapping.model.js';
import GifiMapping from './gifi-mapping.model.js';

class GifiMappingRepository extends Repository<GifiMappingDocument> {
  constructor() {
    super(GifiMapping, [methodRegistryPlugin(), mongoOperationsPlugin()]);
  }
}

const gifiMappingRepository = new GifiMappingRepository();
export default gifiMappingRepository;
export { GifiMappingRepository };
