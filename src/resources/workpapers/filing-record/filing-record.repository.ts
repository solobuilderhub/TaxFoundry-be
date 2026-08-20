/**
 * FilingRecord repository — never soft-deleted (regulatory retention).
 */
import { methodRegistryPlugin, mongoOperationsPlugin, Repository } from '@classytic/mongokit';
import type { FilingRecordDocument } from './filing-record.model.js';
import FilingRecord from './filing-record.model.js';

class FilingRecordRepository extends Repository<FilingRecordDocument> {
  constructor() {
    super(FilingRecord, [methodRegistryPlugin(), mongoOperationsPlugin()]);
  }
}

const filingRecordRepository = new FilingRecordRepository();
export default filingRecordRepository;
export { FilingRecordRepository };
