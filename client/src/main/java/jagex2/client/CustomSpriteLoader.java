package jagex2.client;

import jagex2.graphics.Pix32;

import java.awt.Component;
import java.awt.Graphics2D;
import java.awt.Image;
import java.awt.MediaTracker;
import java.awt.Toolkit;
import java.awt.image.BufferedImage;
import java.awt.image.PixelGrabber;
import java.io.InputStream;

/**
 * Loads custom orb/button sprites from PNG files in the resources directory.
 *
 * Each PNG is a sprite sheet with two halves side-by-side:
 *   - Left half = OFF (inactive) state
 *   - Right half = ON (active) state
 *
 * Sprites:
 *   PrayerOrb.png  (130x27) → 65x27 per half
 *   RunOrb.png     (130x27) → 65x27 per half
 *   RemoveRoofs.png (72x36)  → 36x36 per half
 *
 * The loader splits each sheet into two Pix32 objects (off and on).
 * Transparent pixels in the PNG (alpha=0) are converted to 0 in the pixel
 * array so that Pix32.plotSprite() treats them as transparent (skips them).
 */
public class CustomSpriteLoader {

    private static Pix32 prayerOrbOff;
    private static Pix32 prayerOrbOn;
    private static Pix32 runOrbOff;
    private static Pix32 runOrbOn;
    private static Pix32 removeRoofsOff;
    private static Pix32 removeRoofsOn;
    private static Pix32 checkmark;
    private static Pix32 customMapback;
    /// DrainBG.png — 28x27 circular background for the orb's icon area.
    /// Used as the "drained" background when the orb's resource depletes.
    private static Pix32 drainBg;
    /// Standalone icon sprites (just the icon, no circle background).
    /// Used to build icon masks so the drain effect can skip icon pixels.
    private static Pix32 bootRunIcon;
    private static Pix32 bootWalkIcon;
    private static Pix32 prayerIcon;
    private static Pix32 specialAttackIcon;
    /// Drained (0%) versions of each orb — the fuel is fully transparent.
    /// We blend between the full orb and the drained orb based on pct.
    private static Pix32 prayerOrbDrained;
    private static Pix32 runOrbDrained;
    private static Pix32 specOrbDrained;
    /// SpecialAttackOrbs.png — 2 frames: [0]=100% (green), [1]=activated (gold)
    private static Pix32[] specOrbFullFrames = new Pix32[2];
    /// Special attack orb: 6 frames in SpecialAttackOrb.png (324x27 → 54x27 each)
    ///   0: 100% spec energy (green)
    ///   1: 75%  spec energy (green)
    ///   2: 50%  spec energy (green)
    ///   3: 25%  spec energy (red)
    ///   4: 0%   spec energy (red, drained)
    ///   5: no weapon / weapon has no spec (gray)
    private static Pix32[] specOrbFrames = new Pix32[6];
    private static boolean loaded = false;

    public static final int CUSTOM_MAPBACK_W = 230;
    public static final int CUSTOM_MAPBACK_H = 156;
    public static final int CUSTOM_MAPBACK_X = 492; // screen X = 550 - (230-172) = 492
    public static final int SPEC_ORB_FRAME_COUNT = 6;
    public static final int SPEC_ORB_FRAME_W = 54;
    public static final int SPEC_ORB_FRAME_H = 27;

    /**
     * Load all custom sprites. Must be called after the client's AWT component
     * is available (for MediaTracker). Called once from Client.prepareGame().
     */
    public static void load(Component c) {
        if (loaded) return;
        loaded = true;

        try {
            Pix32[] prayer = loadSplitSprite("PrayerOrb.png", c);
            prayerOrbOff = prayer[0];
            prayerOrbOn = prayer[1];
        } catch (Exception e) {
            System.out.println("Failed to load PrayerOrb.png: " + e);
        }

        try {
            Pix32[] run = loadSplitSprite("RunOrb.png", c);
            runOrbOff = run[0];
            runOrbOn = run[1];
        } catch (Exception e) {
            System.out.println("Failed to load RunOrb.png: " + e);
        }

        try {
            Pix32[] roof = loadSplitSprite("RemoveRoofs.png", c);
            removeRoofsOff = roof[0];
            removeRoofsOn = roof[1];
        } catch (Exception e) {
            System.out.println("Failed to load RemoveRoofs.png: " + e);
        }

        try {
            checkmark = loadSingleSprite("Checkmark.png", c);
        } catch (Exception e) {
            System.out.println("Failed to load Checkmark.png: " + e);
        }

        try {
            customMapback = loadSingleSprite("mapback.png", c);
        } catch (Exception e) {
            System.out.println("Failed to load mapback.png: " + e);
        }

        try {
            drainBg = loadSingleSprite("DrainBG.png", c);
        } catch (Exception e) {
            System.out.println("Failed to load DrainBG.png: " + e);
        }

        try { bootRunIcon = loadSingleSprite("BootRunIcon.png", c); } catch (Exception e) { System.out.println("Failed to load BootRunIcon.png: " + e); }
        try { bootWalkIcon = loadSingleSprite("BootWalkIcon.png", c); } catch (Exception e) { System.out.println("Failed to load BootWalkIcon.png: " + e); }
        try { prayerIcon = loadSingleSprite("PrayerIcon.png", c); } catch (Exception e) { System.out.println("Failed to load PrayerIcon.png: " + e); }
        try { specialAttackIcon = loadSingleSprite("SpecialAttackIcon.png", c); } catch (Exception e) { System.out.println("Failed to load SpecialAttackIcon.png: " + e); }

        // Drained (0%) orb sprites — single frame each
        try { prayerOrbDrained = loadSingleSprite("PrayerOrbDrained.png", c); } catch (Exception e) { System.out.println("Failed to load PrayerOrbDrained.png: " + e); }
        try { runOrbDrained = loadSingleSprite("RunOrbDrained.png", c); } catch (Exception e) { System.out.println("Failed to load RunOrbDrained.png: " + e); }
        try { specOrbDrained = loadSingleSprite("SpecialAttackOrbDrained.png", c); } catch (Exception e) { System.out.println("Failed to load SpecialAttackOrbDrained.png: " + e); }

        // SpecialAttackOrbs.png — 2 frames: [0]=100% green, [1]=activated gold
        try { specOrbFullFrames = loadMultiFrameSprite("SpecialAttackOrbs.png", c, 2); } catch (Exception e) { System.out.println("Failed to load SpecialAttackOrbs.png: " + e); }

        // Special attack orb — 6 frames of 54x27 each, laid out horizontally
        // in a 324x27 PNG. Split into individual Pix32 frames.
        try {
            specOrbFrames = loadMultiFrameSprite("SpecialAttackOrb.png", c, SPEC_ORB_FRAME_COUNT);
        } catch (Exception e) {
            System.out.println("Failed to load SpecialAttackOrb.png: " + e);
        }
    }

    /**
     * Load a PNG that contains N frames laid out horizontally, and return
     * an array of N Pix32 objects (one per frame). Each frame is (totalWidth/N) wide.
     */
    private static Pix32[] loadMultiFrameSprite(String name, Component c, int frameCount) throws Exception {
        InputStream is = CustomSpriteLoader.class.getClassLoader().getResourceAsStream(name);
        if (is == null) {
            System.out.println("Sprite not found: " + name);
            return new Pix32[frameCount];
        }
        byte[] data = new byte[is.available()];
        is.read(data);
        is.close();

        Image image = Toolkit.getDefaultToolkit().createImage(data);
        MediaTracker tracker = new MediaTracker(c);
        tracker.addImage(image, 0);
        tracker.waitForAll();

        int w = image.getWidth(c);
        int h = image.getHeight(c);
        int frameW = w / frameCount;

        int[] fullPixels = new int[h * w];
        PixelGrabber grabber = new PixelGrabber(image, 0, 0, w, h, fullPixels, 0, w);
        grabber.grabPixels();

        Pix32[] frames = new Pix32[frameCount];
        for (int i = 0; i < frameCount; i++) {
            frames[i] = createHalfPix32(fullPixels, i * frameW, 0, frameW, h, w);
        }
        return frames;
    }

    /**
     * Load a PNG from the classpath resources, split it into left (off) and
     * right (on) halves, and return two Pix32 objects.
     */
    private static Pix32[] loadSplitSprite(String name, Component c) throws Exception {
        InputStream is = CustomSpriteLoader.class.getClassLoader().getResourceAsStream(name);
        if (is == null) {
            System.out.println("Sprite not found: " + name);
            return new Pix32[] { null, null };
        }
        byte[] data = new byte[is.available()];
        is.read(data);
        is.close();

        Image image = Toolkit.getDefaultToolkit().createImage(data);
        MediaTracker tracker = new MediaTracker(c);
        tracker.addImage(image, 0);
        tracker.waitForAll();

        int w = image.getWidth(c);
        int h = image.getHeight(c);
        int halfW = w / 2;

        // Grab the full image pixels
        int[] fullPixels = new int[h * w];
        PixelGrabber grabber = new PixelGrabber(image, 0, 0, w, h, fullPixels, 0, w);
        grabber.grabPixels();

        // Split into left and right halves
        Pix32 off = createHalfPix32(fullPixels, 0, 0, halfW, h, w);
        Pix32 on = createHalfPix32(fullPixels, halfW, 0, halfW, h, w);

        return new Pix32[] { off, on };
    }

    /**
     * Create a Pix32 from a sub-region of a pixel array.
     * Converts any pixel with alpha < 128 to 0 (transparent) so plotSprite skips it.
     */
    private static Pix32 createHalfPix32(int[] srcPixels, int srcX, int srcY, int w, int h, int srcW) {
        Pix32 p = new Pix32(w, h);
        p.wi = w;
        p.hi = h;
        p.owi = w;
        p.ohi = h;
        p.xof = 0;
        p.yof = 0;
        p.pixels = new int[w * h];

        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int srcIdx = (srcY + y) * srcW + (srcX + x);
                int pixel = srcPixels[srcIdx];
                int alpha = (pixel >> 24) & 0xFF;
                // If alpha < 128, treat as transparent (0)
                if (alpha < 128) {
                    p.pixels[y * w + x] = 0;
                } else {
                    p.pixels[y * w + x] = 0xFF000000 | (pixel & 0x00FFFFFF);
                }
            }
        }
        return p;
    }

    /**
     * Load a single (non-split) PNG from the classpath resources.
     */
    private static Pix32 loadSingleSprite(String name, Component c) throws Exception {
        InputStream is = CustomSpriteLoader.class.getClassLoader().getResourceAsStream(name);
        if (is == null) {
            System.out.println("Sprite not found: " + name);
            return null;
        }
        byte[] data = new byte[is.available()];
        is.read(data);
        is.close();

        Image image = Toolkit.getDefaultToolkit().createImage(data);
        MediaTracker tracker = new MediaTracker(c);
        tracker.addImage(image, 0);
        tracker.waitForAll();

        int w = image.getWidth(c);
        int h = image.getHeight(c);

        int[] pixels = new int[h * w];
        PixelGrabber grabber = new PixelGrabber(image, 0, 0, w, h, pixels, 0, w);
        grabber.grabPixels();

        return createHalfPix32(pixels, 0, 0, w, h, w);
    }

    public static Pix32 getPrayerOrbOff() { return prayerOrbOff; }
    public static Pix32 getPrayerOrbOn() { return prayerOrbOn; }
    public static Pix32 getRunOrbOff() { return runOrbOff; }
    public static Pix32 getRunOrbOn() { return runOrbOn; }
    public static Pix32 getRemoveRoofsOff() { return removeRoofsOff; }
    public static Pix32 getRemoveRoofsOn() { return removeRoofsOn; }
    public static Pix32 getCheckmark() { return checkmark; }
    public static Pix32 getCustomMapback() { return customMapback; }
    public static Pix32 getDrainBg() { return drainBg; }
    public static Pix32 getBootRunIcon() { return bootRunIcon; }
    public static Pix32 getBootWalkIcon() { return bootWalkIcon; }
    public static Pix32 getPrayerIcon() { return prayerIcon; }
    public static Pix32 getSpecialAttackIcon() { return specialAttackIcon; }
    public static Pix32 getPrayerOrbDrained() { return prayerOrbDrained; }
    public static Pix32 getRunOrbDrained() { return runOrbDrained; }
    public static Pix32 getSpecOrbDrained() { return specOrbDrained; }
    public static Pix32 getSpecOrbFullFrame(int i) {
        if (i < 0 || i >= specOrbFullFrames.length) return null;
        return specOrbFullFrames[i];
    }
    /// Get a specific spec orb frame (0-5). Returns null if not loaded.
    public static Pix32 getSpecOrbFrame(int i) {
        if (i < 0 || i >= specOrbFrames.length) return null;
        return specOrbFrames[i];
    }
}
