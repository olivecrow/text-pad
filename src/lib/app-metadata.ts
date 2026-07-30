import packageMetadata from '../../package.json';
import { env } from '$env/dynamic/public';

export const APP_NAME = 'text-pad';
export const APP_VERSION_FALLBACK = packageMetadata.version;
export const APP_RELEASE_DATE = env.PUBLIC_APP_RELEASE_DATE || '2026-07-31';
export const APP_COPYRIGHT = 'Copyright © 2026 olivecrow. All rights reserved.';
export const APP_LICENSE = 'MIT License';
export const APP_REPOSITORY_URL = 'https://github.com/olivecrow/text-pad';

export const THIRD_PARTY_COMPONENTS = [
  {
    name: 'Tauri',
    license: 'MIT OR Apache-2.0',
    sourceUrl: 'https://github.com/tauri-apps/tauri'
  },
  {
    name: 'Svelte / SvelteKit',
    license: 'MIT',
    sourceUrl: 'https://github.com/sveltejs'
  },
  {
    name: 'Lucide',
    license: 'ISC',
    sourceUrl: 'https://github.com/lucide-icons/lucide'
  },
  {
    name: 'yaml',
    license: 'ISC',
    sourceUrl: 'https://github.com/eemeli/yaml'
  }
] as const;
