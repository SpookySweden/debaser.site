import { mediaExtension, validateMediaFile } from '../media/rules';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '../supabase/client';
import { createMockLettersRepository } from './mock-letters-repository';
import { createSupabaseLettersRepository } from './supabase-letters-repository';
import type { LettersRepository } from './types';

function readSource(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

/**
 * Where letters live: the tables when `NEXT_PUBLIC_LETTERS_DATA_SOURCE=supabase`, or, with that unset, when profiles are on
 * Supabase (letters live on a profile, so they follow it, as window layouts do); otherwise in memory.
 */
const REQUESTED = readSource(process.env.NEXT_PUBLIC_LETTERS_DATA_SOURCE) ?? readSource(process.env.NEXT_PUBLIC_PROFILE_DATA_SOURCE);

export const LETTERS_DATA_SOURCE: 'mock' | 'supabase' = REQUESTED === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

let repository: LettersRepository | null = null;

export function getLettersRepository(): LettersRepository {
  if (repository) return repository;
  const client = LETTERS_DATA_SOURCE === 'supabase' ? getSupabaseBrowserClient() : null;
  repository = client ? createSupabaseLettersRepository(client) : createMockLettersRepository();
  return repository;
}

const STAMP_BUCKET = 'images';
const UPLOADS_PER_WINDOW = 5;
const WINDOW_MS = 10 * 60 * 1000;
const recentUploads: number[] = [];

/**
 * Uploads a stamp picture and gives back its address. The `images` bucket holds it under the owner's own folder (its rules:
 * picture types only, 2 MB at most, only into your own folder); the type and size are checked here first too, and a
 * browser may send five in ten minutes. On the mock, the picture is shown from the browser's own memory for the page load.
 */
export async function uploadStamp(owner: string, file: File): Promise<string> {
  const refusal = validateMediaFile('image', file);
  if (refusal !== undefined) throw new Error(refusal);
  const now = Date.now();
  while (recentUploads.length > 0 && now - recentUploads[0] > WINDOW_MS) recentUploads.shift();
  if (recentUploads.length >= UPLOADS_PER_WINDOW) throw new Error('THAT IS FIVE PICTURES IN TEN MINUTES. TRY AGAIN IN A FEW MINUTES.');
  recentUploads.push(now);
  const client = LETTERS_DATA_SOURCE === 'supabase' ? getSupabaseBrowserClient() : null;
  if (!client) return URL.createObjectURL(file);
  const stamp = new Date(now).toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const path = `${owner}/letter-stamp-${stamp}${mediaExtension('image', file) ?? '.png'}`;
  const { error } = await client.storage.from(STAMP_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error !== null) throw new Error('THE PICTURE COULD NOT BE SAVED.');
  return client.storage.from(STAMP_BUCKET).getPublicUrl(path).data.publicUrl;
}
