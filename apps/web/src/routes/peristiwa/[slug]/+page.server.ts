import { error } from '@sveltejs/kit';
import { findPeristiwa } from '#lib/peristiwa.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
  const peristiwa = findPeristiwa(params.slug);
  if (!peristiwa) error(404, 'Peristiwa tidak ditemukan');
  return { peristiwa };
};
