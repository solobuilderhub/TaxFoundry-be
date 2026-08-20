/** T183Authorization repository — append-only officer authorization evidence. */
import { methodRegistryPlugin, mongoOperationsPlugin, Repository } from '@classytic/mongokit';
import type { T183AuthorizationDocument } from './t183-authorization.model.js';
import T183Authorization from './t183-authorization.model.js';

class T183AuthorizationRepository extends Repository<T183AuthorizationDocument> {
  constructor() {
    super(T183Authorization, [methodRegistryPlugin(), mongoOperationsPlugin()]);
  }
}

const t183AuthorizationRepository = new T183AuthorizationRepository();
export default t183AuthorizationRepository;
export { T183AuthorizationRepository };
