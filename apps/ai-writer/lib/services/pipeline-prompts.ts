/**
 * The pipeline YAML each service loads (`templates/collabo-cafe/pipeline/<pipelineId>.yaml`) and the prompt it reads
 * from it (`prompts.<promptKey>`).
 *
 * The services and the templates validator (`lib/templates-validation/`) both read this table, so a template that
 * lacks a prompt a service needs fails validation instead of sending "undefined" to the model.
 */
export const PIPELINE_PROMPTS = {
  selection: { pipelineId: '1-selection', promptKey: 'selection' },
  extraction: { pipelineId: '2-extraction', promptKey: 'extraction' },
  subpageExtraction: { pipelineId: '2.5-subpage-extraction', promptKey: 'extract_subpages' },
  title: { pipelineId: '3-title', promptKey: 'generate_title' },
  content: { pipelineId: '4-content', promptKey: 'generate_content' },
  articlePoints: { pipelineId: '4.5-article-points', promptKey: 'write_features' },
  excerpt: { pipelineId: '6-meta-description', promptKey: 'write_excerpt' },
} as const;
