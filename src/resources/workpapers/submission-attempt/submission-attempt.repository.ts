/** SubmissionAttempt repository — durable pre-egress transmission attempts. */
import { methodRegistryPlugin, mongoOperationsPlugin, Repository } from '@classytic/mongokit';
import type { SubmissionAttemptDocument } from './submission-attempt.model.js';
import SubmissionAttempt from './submission-attempt.model.js';

class SubmissionAttemptRepository extends Repository<SubmissionAttemptDocument> {
  constructor() {
    super(SubmissionAttempt, [methodRegistryPlugin(), mongoOperationsPlugin()]);
  }
}

const submissionAttemptRepository = new SubmissionAttemptRepository();
export default submissionAttemptRepository;
export { SubmissionAttemptRepository };
