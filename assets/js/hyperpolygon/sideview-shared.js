// Shared side-view geometry for the hyperpolygon and E_k Nakajima widgets.
//
// Both `assets/js/hyperpolygon/sideview.js` and
// `assets/js/ek-nakajima/core-view.js` draw the same "black dot climbs a
// paraboloid / rides a sphere" portrait with the same tuned constants and
// the same sphere/meridian convention. This dependency-free, Node-safe
// module is the single source of truth for those values and helpers so the
// two views cannot silently drift apart (2026-10-01 review finding).
//
// No THREE, no DOM, no solver import: safe to pull into either widget.

// Paraboloid shape constants. phi(t) = atan(PHI_K * t / (1 - t)) opens
// gently (PHI_K = 0.5 puts phi ~ 0.46 rad at t = 0.5) and saturates at
// PHI_CAP = 80 deg near t ~ 0.92, so the dot stops climbing before the
// paraboloid gets cartoonishly steep. PARAB_FOCAL sets the scale:
// surface z_local = rho^2 / (2 * PARAB_FOCAL) above the apex; the drawn
// paraboloid radius is rhoMax = PARAB_FOCAL * tan(PHI_CAP).
export const PARAB_FOCAL = 0.1;
export const PHI_K = 0.5;
export const PHI_CAP = (80 * Math.PI) / 180;

// I-stratum paraboloid climb constant (same family as PHI_K).
export const PHI_K_STRAT = 0.5;

// "lim t -> infinity" affordance band and the tip-paraboloid ghost ramp.
export const T_NEAR_INF = 0.9;
export const T_PEEK_LO = 0.9;
export const T_PEEK_HI = 0.97;

// Central -> exterior/arm capture band: the central branch blends onto a
// sphere continuously as the flow parameter approaches the attachment.
export const CAP_BAND_R = 0.1;
export const CAP_BAND_TH = 0.3;
export const CAP_NEAR_INF_W = 0.5;

// ---------------------------------------------------------------------------
// 3D vector helpers (plain arrays).
// ---------------------------------------------------------------------------
export function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function scale3(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function len3(a) {
  return Math.sqrt(dot3(a, a));
}
// Unit vector along a (or null when degenerate — callers substitute a
// fallback axis, e.g. +x when a perpendicular frame vanishes at a pole).
export function unit3(a) {
  const n = len3(a);
  if (n < 1e-12) return null;
  return [a[0] / n, a[1] / n, a[2] / n];
}

// Point on a 2-sphere of radius R centred at the origin, polar angle
// measured from the south pole: r = 0 -> south, r = 1 -> north, theta = 0
// the +x meridian. Shared by both side views; the attachment/meridian
// geometry depends on this exact convention.
export function spherePoint(r, theta, R) {
  const psi = Math.PI * r;
  return [R * Math.sin(psi) * Math.cos(theta), -R * Math.cos(psi), -R * Math.sin(psi) * Math.sin(theta)];
}
