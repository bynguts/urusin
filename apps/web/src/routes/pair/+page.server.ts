import type { PageServerLoad } from './$types';

// ID ekstensi dipin (PUBLIC_EXTENSION_ID, bukan rahasia). Dibaca saat runtime di server (adapter-node).
export const load: PageServerLoad = () => ({ extensionId: process.env.PUBLIC_EXTENSION_ID ?? '' });
