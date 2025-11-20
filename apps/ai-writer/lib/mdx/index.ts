/**
 * MDX Module Entry Point
 *
 * @module lib/mdx
 */

// Export types
export type {
  MdxFrontmatter,
  GenerateMdxFrontmatterInput,
  MdxArticle,
} from './types';

export { MDX_DEFAULTS } from './types';

// Export template generator functions
export {
  generateMdxFrontmatter,
  serializeFrontmatter,
  generateMdxFilePath,
  generateMdxArticle,
  isValidMdxFrontmatter,
} from './template-generator';
