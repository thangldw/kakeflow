// Types for build-pwa-catalog.mjs, so TypeScript tests can import it.
export interface CatalogSourceFile {
  readonly path: string
  readonly source: string
}

export declare const PWA_CATALOG_ROOTS: readonly string[]
export declare const LABEL_SOURCE_ROOT: string
export declare const NAVIGATION_SOURCE: string
export declare const FULL_CATALOG_PATHS: { readonly en: string; readonly vi: string }
export declare const SUBSET_PATHS: { readonly en: string; readonly vi: string }

export declare function collectKeys(files: readonly CatalogSourceFile[]): string[]
export declare function buildSubsets(
  fullEn: Readonly<Record<string, string>>,
  fullVi: Readonly<Record<string, string>>,
  keys: readonly string[],
): { en: Record<string, string>; vi: Record<string, string>; missing: string[] }
export declare function serializeCatalog(catalog: Readonly<Record<string, string>>): string
export declare function listPwaCatalogSources(rootDir: string): Promise<CatalogSourceFile[]>
export declare function generatePwaCatalog(rootDir: string): Promise<{ keys: string[]; en: string; vi: string; missing: string[] }>
