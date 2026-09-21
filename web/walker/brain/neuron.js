// Rate-coded neuron primitives.
//
// Every unit here is a leaky integrator standing in for a population of real
// neurons of one cell type. The male CNS connectome has 166k neurons in 11,691
// types; we model ~10 types at population level, not individual cells.

export const TWO_PI = Math.PI * 2;

export const relu = (x) => (x > 0 ? x : 0);
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** Wrap an angle to (-pi, pi]. */
export function wrapPi(a) {
  a = (a + Math.PI) % TWO_PI;
  if (a <= 0) a += TWO_PI;
  return a - Math.PI;
}

/** Wrap an angle to [0, 2pi). */
export function wrapTwoPi(a) {
  a %= TWO_PI;
  return a < 0 ? a + TWO_PI : a;
}

/**
 * A single leaky-integrator rate unit: tau * dv/dt = -v + input.
 * `rate` is the rectified output that downstream partners actually see.
 */
export class Unit {
  constructor(name, tau = 0.05) {
    this.name = name;
    this.tau = tau;
    this.v = 0;
    this.rate = 0;
  }

  step(input, dt) {
    this.v += (dt / this.tau) * (-this.v + input);
    this.rate = relu(this.v);
    return this.rate;
  }

  reset() {
    this.v = 0;
    this.rate = 0;
  }
}

/**
 * A ring of `n` units tiling 360 degrees of angular space -- the layout the
 * ellipsoid body actually uses (EPG wedges) and that we reuse for the
 * fan-shaped body goal representation.
 */
export class RingPopulation {
  constructor(name, n, tau = 0.05) {
    this.name = name;
    this.n = n;
    this.tau = tau;
    this.v = new Float64Array(n);
    this.rate = new Float64Array(n);
    this.theta = new Float64Array(n);
    for (let i = 0; i < n; i++) this.theta[i] = (TWO_PI * i) / n;
  }

  step(input, dt) {
    const k = dt / this.tau;
    for (let i = 0; i < this.n; i++) {
      this.v[i] += k * (-this.v[i] + input[i]);
      this.rate[i] = relu(this.v[i]);
    }
    return this.rate;
  }

  /** Total activity, used for the normalisation that stands in for global inhibition. */
  sum() {
    let s = 0;
    for (let i = 0; i < this.n; i++) s += this.rate[i];
    return s;
  }

  /** Rescale so the population sums to `target` -- a stand-in for the EB's global inhibition. */
  normalise(target) {
    const s = this.sum();
    if (s < 1e-9) return;
    const g = target / s;
    for (let i = 0; i < this.n; i++) {
      this.rate[i] *= g;
      this.v[i] *= g;
    }
  }

  /**
   * Population-vector decode: the angle the bump is currently sitting at.
   * Returns { angle, strength } where strength is the vector length over the
   * summed rate (1 = perfectly concentrated bump, 0 = flat/no bump).
   */
  decode() {
    let x = 0;
    let y = 0;
    let s = 0;
    for (let i = 0; i < this.n; i++) {
      x += this.rate[i] * Math.cos(this.theta[i]);
      y += this.rate[i] * Math.sin(this.theta[i]);
      s += this.rate[i];
    }
    if (s < 1e-9) return { angle: 0, strength: 0 };
    return { angle: Math.atan2(y, x), strength: Math.hypot(x, y) / s };
  }

  reset() {
    this.v.fill(0);
    this.rate.fill(0);
  }
}

/** A von Mises style bump of unit peak height, centred on `mu`. */
export function bump(out, theta, mu, width, peak = 1) {
  for (let i = 0; i < out.length; i++) {
    out[i] = peak * Math.exp(width * (Math.cos(theta[i] - mu) - 1));
  }
  return out;
}

/** Circular mean of a list of angles. */
export function circularMean(angles) {
  let x = 0;
  let y = 0;
  for (const a of angles) {
    x += Math.cos(a);
    y += Math.sin(a);
  }
  return Math.atan2(y, x);
}

/** Deterministic PRNG so runs are reproducible when a seed is given. */
export function makeRandom(seed = 1) {
  let s = seed >>> 0 || 1;
  return function random() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
