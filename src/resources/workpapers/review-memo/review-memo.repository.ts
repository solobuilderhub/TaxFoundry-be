/**
 * ReviewMemo repository
 */
import { methodRegistryPlugin, mongoOperationsPlugin, Repository } from '@classytic/mongokit';
import type { ReviewMemoDocument } from './review-memo.model.js';
import ReviewMemo from './review-memo.model.js';

class ReviewMemoRepository extends Repository<ReviewMemoDocument> {
  constructor() {
    super(ReviewMemo, [methodRegistryPlugin(), mongoOperationsPlugin()]);
  }
}

const reviewMemoRepository = new ReviewMemoRepository();
export default reviewMemoRepository;
export { ReviewMemoRepository };
