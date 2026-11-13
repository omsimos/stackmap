// What the project is called where it lives: one place to change on the next rename.
export const REPO_SLUG = 'omsimos/stackmap';
export const REPO = `https://github.com/${REPO_SLUG}`;
export const PACKAGE = '@omsimos/stackmap';

/** The JSON Schema a release publishes, as the `$schema` an editor reads. */
export const schemaUrl = (version: string) => `https://unpkg.com/${PACKAGE}@${version}/dist/stackmap.schema.json`;
