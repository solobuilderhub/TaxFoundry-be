/**
 * EngagementYear repository
 */
import { methodRegistryPlugin, mongoOperationsPlugin, Repository } from '@classytic/mongokit';
import type { EngagementYearDocument } from './engagement-year.model.js';
import EngagementYear from './engagement-year.model.js';

class EngagementYearRepository extends Repository<EngagementYearDocument> {
  constructor() {
    super(EngagementYear, [methodRegistryPlugin(), mongoOperationsPlugin()]);
  }
}

const engagementYearRepository = new EngagementYearRepository();
export default engagementYearRepository;
export { EngagementYearRepository };
