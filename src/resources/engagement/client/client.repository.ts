/**
 * Client repository
 */
import { methodRegistryPlugin, mongoOperationsPlugin, Repository } from '@classytic/mongokit';
import type { ClientDocument } from './client.model.js';
import Client from './client.model.js';

class ClientRepository extends Repository<ClientDocument> {
  constructor() {
    super(Client, [methodRegistryPlugin(), mongoOperationsPlugin()]);
  }
}

const clientRepository = new ClientRepository();
export default clientRepository;
export { ClientRepository };
