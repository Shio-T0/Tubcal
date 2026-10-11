// Scores in any of AniList's five formats, as one vocabulary: the words for a
// number, the 1–10 tile a score lands on, and the average of a title's category
// scores. Pure — the title page's list panel and the curtain call both draw from
// it, so a "Very good" means the same 8 in both places.

import { SCORE_MAX, SCORE_STEP } from './shared.jsx';

export const WORDS = ['', 'Appalling', 'Horrible', 'Very bad', 'Bad', 'Average', 'Fine', 'Good', 'Very good', 'Great', 'Masterpiece'];
export const FACE_WORDS = { 1: 'Not for me', 2: 'It was fine', 3: 'Loved it' };

/** The format's top score and the smallest step a control moves by. */
export function scaleOf(format) {
  return { max: SCORE_MAX[format] || 10, step: SCORE_STEP[format] || 1 };
}

/** A score in the viewer's format → the nearest whole 1–10 (for words and tiles). */
export function tenOf(v, format) {
  if (!v) return 0;
  if (format === 'POINT_100') return Math.max(1, Math.round(v / 10));
  if (format === 'POINT_5') return v * 2;
  if (format === 'POINT_3') return { 1: 3, 2: 6, 3: 9 }[v] || 0;
  return Math.max(1, Math.round(v));
}

/** A 1–10 tile (or a star, counted in tens) → a score in the viewer's format. */
export function fromTen(n, format) {
  if (format === 'POINT_100') return n * 10;
  if (format === 'POINT_5') return n / 2;
  return n;
}

/** …and → 0–100, to seed a review's score from the rating. */
export function hundredOf(v, format) {
  if (!v) return null;
  if (format === 'POINT_100') return v;
  if (format === 'POINT_5') return v * 20;
  if (format === 'POINT_3') return { 1: 35, 2: 60, 3: 85 }[v] ?? null;
  return Math.round(v * 10);
}

/** The word for a score: "Very good", or a face's sentence on the 3-point scale. */
export function wordFor(v, format) {
  if (!v) return '';
  if (format === 'POINT_3') return FACE_WORDS[v] || '';
  return WORDS[tenOf(v, format)] || '';
}

/** A score as it reads in its format: 7.5 on the decimal scale, whole elsewhere. */
export function fmtScore(v, format) {
  if (!v) return '—';
  return format === 'POINT_10_DECIMAL' ? Number(v).toFixed(1).replace(/\.0$/, '') : String(Math.round(v));
}

export function scoreText(v, format) {
  if (!v) return '';
  return `${fmtScore(v, format)} / ${scaleOf(format).max}`;
}

/** Clamp a value into the format's range and onto its step. */
export function snap(v, format) {
  const { max, step } = scaleOf(format);
  const n = Math.round((Number(v) || 0) / step) * step;
  return Math.min(max, Math.max(0, Number(n.toFixed(2))));
}

/** The mean of the categories that have a score (0 is AniList's "not scored"), in
 *  the viewer's format — one decimal on the decimal scale, whole elsewhere. Null
 *  when nothing is scored yet. */
export function categoryAverage(scores, categories, format) {
  const vals = (categories || []).map((c) => Number(scores?.[c]) || 0).filter((v) => v > 0);
  if (!vals.length) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (format === 'POINT_10_DECIMAL') return Math.round(mean * 10) / 10;
  return Math.max(1, Math.round(mean));
}
