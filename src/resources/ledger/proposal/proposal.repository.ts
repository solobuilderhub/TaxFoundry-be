/**
 * Proposal repository — MongoKit (proposals can be withdrawn).
 */
import { methodRegistryPlugin, mongoOperationsPlugin, Repository } from '@classytic/mongokit';
import type { ProposalDocument } from './proposal.model.js';
import Proposal from './proposal.model.js';

class ProposalRepository extends Repository<ProposalDocument> {
  constructor() {
    super(Proposal, [methodRegistryPlugin(), mongoOperationsPlugin()]);
  }
}

const proposalRepository = new ProposalRepository();
export default proposalRepository;
export { ProposalRepository };
