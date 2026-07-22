package jagex2.shell;

import java.util.Random;

/**
 * Simple 2D Perlin-like noise generator for generating greyscale patterns
 * reminiscent of the OSRS login screen background.
 *
 * This is a classic value-noise implementation: generate a low-resolution grid
 * of random gradients, then smoothly interpolate between them. Multiple octaves
 * are summed for a fractal appearance.
 *
 * Not a true Perlin noise (no gradient rotation), but visually similar and
 * more than sufficient for texture generation.
 */
public final class PerlinNoise {

    private final int[] perm = new int[512];

    /**
     * Create a noise generator with the given seed.
     */
    public PerlinNoise(long seed) {
        Random rng = new Random(seed);
        int[] p = new int[256];
        for (int i = 0; i < 256; i++) p[i] = i;
        // Fisher-Yates shuffle
        for (int i = 255; i > 0; i--) {
            int j = rng.nextInt(i + 1);
            int tmp = p[i]; p[i] = p[j]; p[j] = tmp;
        }
        for (int i = 0; i < 512; i++) perm[i] = p[i & 255];
    }

    /**
     * Compute fractal (multi-octave) noise at (x, y).
     * Returns a value in roughly [-1, 1].
     *
     * @param octaves     number of noise layers to sum (4-6 is typical)
     * @param persistence amplitude multiplier per octave (0.5 is standard)
     * @param scale       frequency of the base octave (lower = smoother)
     */
    public double fractal(double x, double y, int octaves, double persistence, double scale) {
        double total = 0.0;
        double frequency = scale;
        double amplitude = 1.0;
        double maxValue = 0.0;
        for (int i = 0; i < octaves; i++) {
            total += noise(x * frequency, y * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= 2.0;
        }
        return total / maxValue;
    }

    /**
     * Single-octave 2D value noise. Returns roughly [-1, 1].
     */
    public double noise(double x, double y) {
        int xi = fastFloor(x) & 255;
        int yi = fastFloor(y) & 255;
        double xf = x - fastFloor(x);
        double yf = y - fastFloor(y);

        double u = fade(xf);
        double v = fade(yf);

        // Hash the four corners
        int aa = perm[perm[xi] + yi];
        int ab = perm[perm[xi] + yi + 1];
        int ba = perm[perm[xi + 1] + yi];
        int bb = perm[perm[xi + 1] + yi + 1];

        // Pseudo-gradient: use the hash to pick a value in [-1, 1]
        double x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
        double x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
        return lerp(x1, x2, v);
    }

    private static int fastFloor(double v) {
        int i = (int) v;
        return v < i ? i - 1 : i;
    }

    private static double fade(double t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    private static double lerp(double a, double b, double t) {
        return a + t * (b - a);
    }

    private static double grad(int hash, double x, double y) {
        // Pick one of 8 gradient directions based on hash
        switch (hash & 7) {
            case 0: return  x + y;
            case 1: return -x + y;
            case 2: return  x - y;
            case 3: return -x - y;
            case 4: return  x;
            case 5: return -x;
            case 6: return  y;
            default: return -y;
        }
    }
}
