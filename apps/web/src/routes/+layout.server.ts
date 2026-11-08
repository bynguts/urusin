import { shortSha } from '#lib/server/build-info.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => ({ version: shortSha() });
