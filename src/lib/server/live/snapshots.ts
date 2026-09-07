import { createDecipheriv, createHash } from 'node:crypto';
import { digest, freezeReview } from '../../../../bin/live-snapshot.js';
export { feedbackHome } from '../../../../bin/live-snapshot.js';
import { error } from '@sveltejs/kit';
import { resolveToken } from '../shortLinks';

export function decodePaths(token: string, secret: string) {
 const resolved = resolveToken(token), payload = Buffer.from(resolved, 'base64url');
 if (payload.length <= 28 || payload.toString('base64url') !== resolved) throw error(404, 'Review not found');
 const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), payload.subarray(0,12));
 decipher.setAuthTag(payload.subarray(12,28));
 const raw = Buffer.concat([decipher.update(payload.subarray(28)),decipher.final()]).toString('utf8');
 try { const json = JSON.parse(raw); const files = Array.isArray(json) ? json : json.files; if (Array.isArray(files) && files.every(p=>typeof p==='string')) return files as string[]; } catch { /* Legacy single path. */ }
 return [raw];
}
export type { Snapshot } from '../../../../bin/live-snapshot.js';
export function liveSnapshot(token: string, secret = process.env.ONLINE_REVIEW_URL_SECRET) {
 if (!secret) throw error(503,'Live review is not configured');
 let sources:string[];
 try { sources=decodePaths(token,secret); } catch { throw error(404,'Review not found'); }
 try { return freezeReview(digest(resolveToken(token)),sources); } catch { throw error(404,'Review snapshot is unavailable'); }
}
