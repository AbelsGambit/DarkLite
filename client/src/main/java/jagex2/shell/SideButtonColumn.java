package jagex2.shell;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Cursor;
import java.awt.Dimension;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.util.ArrayList;
import java.util.List;

import javax.swing.JPanel;
import javax.swing.Timer;

/**
 * Column of 5 square (32x32) side buttons with drawn icons.
 * Each button toggles an associated leaflet panel.
 * Only one leaflet open at a time — clicking the active button closes it.
 *
 * Button list (top to bottom): Settings, Worlds, Friends, Notes, Help
 */
public class SideButtonColumn extends JPanel {

    public static final int COLUMN_WIDTH = 36;   // 32px button + 2px padding each side
    public static final int BUTTON_SIZE = 32;
    public static final int BUTTON_GAP = 4;

    /** Button definition: id, label, icon type. */
    public static final class ButtonDef {
        public final String id;
        public final String label;
        public final IconType icon;
        public ButtonDef(String id, String label, IconType icon) {
            this.id = id; this.label = label; this.icon = icon;
        }
    }

    public enum IconType { GEAR, GLOBE, PEOPLE, DOCUMENT, QUESTION }

    private static final ButtonDef[] BUTTONS = {
        new ButtonDef("settings", "Settings", IconType.GEAR),
        new ButtonDef("worlds",   "Worlds",   IconType.GLOBE),
        new ButtonDef("friends",  "Friends",  IconType.PEOPLE),
        new ButtonDef("notes",    "Notes",    IconType.DOCUMENT),
        new ButtonDef("help",     "Help",     IconType.QUESTION),
    };

    public interface Listener {
        void onButtonToggle(String id, boolean nowOpen);
    }

    private final List<Listener> listeners = new ArrayList<>();
    private int hoveredButton = -1;
    private int pressedButton = -1;
    private int activeButton = -1;

    // Pre-rendered Perlin noise textures for each button state.
    // OSRS-login-screen-style greyscale noise, tinted brown for the button color.
    private final java.awt.image.BufferedImage noiseNormal;
    private final java.awt.image.BufferedImage noiseHovered;
    private final java.awt.image.BufferedImage noiseActive;

    public SideButtonColumn() {
        setPreferredSize(new Dimension(COLUMN_WIDTH, 543));
        setMinimumSize(new Dimension(COLUMN_WIDTH, 543));
        setMaximumSize(new Dimension(COLUMN_WIDTH, Integer.MAX_VALUE));
        setLayout(null);
        setOpaque(true);
        setBackground(Color.BLACK);

        // Pre-render the Perlin noise textures (one per button state).
        // Using the same seed for all three so the pattern is consistent;
        // only the tint color changes between states.
        // Colors use a wide greyscale range (dark to light) for strong OSRS-login-screen contrast.
        noiseNormal  = generateNoiseTexture(BUTTON_SIZE, BUTTON_SIZE, 42L,
                new Color(0x8a, 0x7a, 0x64), new Color(0x2a, 0x22, 0x18));
        noiseHovered = generateNoiseTexture(BUTTON_SIZE, BUTTON_SIZE, 42L,
                new Color(0xaa, 0x9a, 0x84), new Color(0x3a, 0x32, 0x24));
        noiseActive  = generateNoiseTexture(BUTTON_SIZE, BUTTON_SIZE, 42L,
                new Color(0xe4, 0xb4, 0x3a), new Color(0x60, 0x40, 0x10));

        MouseAdapter mouse = new MouseAdapter() {
            @Override
            public void mouseMoved(MouseEvent e) {
                int prev = hoveredButton;
                hoveredButton = buttonAt(e.getY());
                if (prev != hoveredButton) {
                    setCursor(hoveredButton >= 0
                            ? Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
                            : Cursor.getDefaultCursor());
                    repaint();
                }
            }

            @Override
            public void mouseExited(MouseEvent e) {
                if (hoveredButton != -1) {
                    hoveredButton = -1;
                    repaint();
                }
            }

            @Override
            public void mousePressed(MouseEvent e) {
                pressedButton = buttonAt(e.getY());
                repaint();
            }

            @Override
            public void mouseReleased(MouseEvent e) {
                int b = buttonAt(e.getY());
                if (b == pressedButton && b >= 0) {
                    toggleButton(b);
                }
                pressedButton = -1;
                repaint();
            }
        };
        addMouseMotionListener(mouse);
        addMouseListener(mouse);
    }

    public void addListener(Listener l) { listeners.add(l); }

    private void toggleButton(int idx) {
        if (activeButton == idx) {
            activeButton = -1;
            fireToggle(BUTTONS[idx].id, false);
        } else {
            int prev = activeButton;
            activeButton = idx;
            if (prev >= 0) {
                fireToggle(BUTTONS[prev].id, false);
            }
            fireToggle(BUTTONS[idx].id, true);
        }
        repaint();
    }

    private void fireToggle(String id, boolean open) {
        for (Listener l : listeners) {
            l.onButtonToggle(id, open);
        }
    }

    /** Close any open button/leaflet (called when user clicks outside, etc.) */
    public void closeAll() {
        if (activeButton >= 0) {
            int prev = activeButton;
            activeButton = -1;
            fireToggle(BUTTONS[prev].id, false);
            repaint();
        }
    }

    /** Y-coordinate of the top of the i-th button. */
    private int buttonTop(int i) {
        int totalHeight = BUTTONS.length * BUTTON_SIZE + (BUTTONS.length - 1) * BUTTON_GAP;
        int startY = (getHeight() - totalHeight) / 2;
        return startY + i * (BUTTON_SIZE + BUTTON_GAP);
    }

    /** Find which button (if any) is at the given y. */
    private int buttonAt(int y) {
        for (int i = 0; i < BUTTONS.length; i++) {
            int top = buttonTop(i);
            if (y >= top && y < top + BUTTON_SIZE) {
                return i;
            }
        }
        return -1;
    }

    @Override
    protected void paintComponent(Graphics g) {
        super.paintComponent(g);
        Graphics2D g2 = (Graphics2D) g.create();
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g2.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);

            // Black background
            g2.setColor(Color.BLACK);
            g2.fillRect(0, 0, getWidth(), getHeight());

            for (int i = 0; i < BUTTONS.length; i++) {
                int x = 2;
                int y = buttonTop(i);
                drawButton(g2, x, y, BUTTONS[i], i);
            }
        } finally {
            g2.dispose();
        }
    }

    private void drawButton(Graphics2D g2, int x, int y, ButtonDef def, int idx) {
        boolean hovered = (idx == hoveredButton);
        boolean pressed = (idx == pressedButton);
        boolean active = (idx == activeButton);

        // Slight press offset
        if (pressed) y += 1;

        // Pick the pre-rendered Perlin noise texture for the current state
        java.awt.image.BufferedImage tex;
        if (active)      tex = noiseActive;
        else if (hovered) tex = noiseHovered;
        else              tex = noiseNormal;

        // Clip to the rounded button shape, then draw the noise texture
        java.awt.Shape clip = new java.awt.geom.RoundRectangle2D.Float(x, y, BUTTON_SIZE, BUTTON_SIZE, 3, 3);
        java.awt.Shape oldClip = g2.getClip();
        g2.clip(clip);
        g2.drawImage(tex, x, y, null);
        g2.setClip(oldClip);

        // Top highlight
        g2.setColor(active ? new Color(0xff, 0xd2, 0x4a) : new Color(0x8a, 0x6a, 0x3a));
        g2.drawLine(x + 2, y + 1, x + BUTTON_SIZE - 3, y + 1);

        // Border
        g2.setColor(new Color(0x2a, 0x1d, 0x0a));
        g2.setStroke(new BasicStroke(1f));
        g2.drawRoundRect(x, y, BUTTON_SIZE, BUTTON_SIZE, 3, 3);

        // Inset shadow when active
        if (active) {
            g2.setColor(new Color(0, 0, 0, 80));
            g2.drawLine(x + 2, y + 2, x + BUTTON_SIZE - 3, y + 2);
        }

        // Icon
        Color iconColor = active ? Color.WHITE : new Color(0xf5, 0xe6, 0xc8);
        drawIcon(g2, x + BUTTON_SIZE / 2, y + BUTTON_SIZE / 2, 9, def.icon, iconColor);

        // Tooltip — set as the cursor tooltip (no Swing tooltip for simplicity)
        // (Could use setToolTipText per-region, but easier to leave it off)
    }

    /** Draw one of the icon types centered at (cx, cy) with radius r. */
    private void drawIcon(Graphics2D g2, int cx, int cy, int r, IconType icon, Color color) {
        g2 = (Graphics2D) g2.create();
        g2.translate(cx, cy);
        g2.setColor(color);
        g2.setStroke(new BasicStroke(1.6f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));

        switch (icon) {
            case GEAR:
                drawGearIcon(g2, r);
                break;
            case GLOBE:
                drawGlobeIcon(g2, r);
                break;
            case PEOPLE:
                drawPeopleIcon(g2, r);
                break;
            case DOCUMENT:
                drawDocumentIcon(g2, r);
                break;
            case QUESTION:
                drawQuestionIcon(g2, r);
                break;
        }
        g2.dispose();
    }

    private void drawGearIcon(Graphics2D g2, int r) {
        // Simplified gear: 8-tooth circle
        java.awt.geom.GeneralPath p = new java.awt.geom.GeneralPath();
        int teeth = 8;
        double toothW = 0.2;
        double inner = r * 0.75;
        double outer = r;
        for (int i = 0; i < teeth; i++) {
            double a0 = i * 2 * Math.PI / teeth - Math.PI / 2;
            double a1 = a0 - toothW;
            double a2 = a0 + toothW;
            double a3 = a0 + 2 * Math.PI / teeth - toothW;
            if (i == 0) p.moveTo(Math.cos(a1) * outer, Math.sin(a1) * outer);
            p.lineTo(Math.cos(a2) * outer, Math.sin(a2) * outer);
            p.lineTo(Math.cos(a2) * inner, Math.sin(a2) * inner);
            p.lineTo(Math.cos(a3) * inner, Math.sin(a3) * inner);
        }
        p.closePath();
        g2.fill(p);
        g2.setColor(new Color(0x2a, 0x1d, 0x0a));
        g2.fillOval(-2, -2, 5, 5);
    }

    private void drawGlobeIcon(Graphics2D g2, int r) {
        // Circle + meridians + equator
        g2.drawOval(-r, -r, 2 * r, 2 * r);
        g2.drawOval(-r / 2, -r, r, 2 * r);
        g2.drawLine(-r, 0, r, 0);
        g2.drawArc(-r, -r / 2, 2 * r, r, 0, 180);
        g2.drawArc(-r, -r, 2 * r, 2 * r, 0, 180);
    }

    private void drawPeopleIcon(Graphics2D g2, int r) {
        // Two heads + shoulders
        // Left (smaller, behind)
        g2.setColor(new Color(0xf5, 0xe6, 0xc8, 180));
        g2.fillOval(-r - 1, -r + 1, r, r - 1);
        g2.fillArc(-r - 1, 0, r + 1, r + 2, 0, 180);
        // Right (front)
        g2.setColor(new Color(0xf5, 0xe6, 0xc8));
        g2.fillOval(1, -r, r, r);
        g2.fillArc(0, -1, r + 2, r + 3, 0, 180);
    }

    private void drawDocumentIcon(Graphics2D g2, int r) {
        // Rectangle with folded corner + lines
        java.awt.Polygon doc = new java.awt.Polygon();
        doc.addPoint(-r + 1, -r);
        doc.addPoint(r - 3, -r);
        doc.addPoint(r, -r + 3);
        doc.addPoint(r, r);
        doc.addPoint(-r + 1, r);
        g2.fill(doc);
        g2.setColor(new Color(0x2a, 0x1d, 0x0a));
        g2.setStroke(new BasicStroke(1f));
        g2.draw(doc);
        // Lines
        g2.drawLine(-r + 3, -3, r - 3, -3);
        g2.drawLine(-r + 3, 0, r - 3, 0);
        g2.drawLine(-r + 3, 3, r - 3, 3);
    }

    private void drawQuestionIcon(Graphics2D g2, int r) {
        // Circle + question mark (drawn with strokes)
        g2.fillOval(-r, -r, 2 * r, 2 * r);
        g2.setColor(new Color(0x2a, 0x1d, 0x0a));
        g2.setStroke(new BasicStroke(1.8f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        // Question mark curve
        java.awt.geom.QuadCurve2D q = new java.awt.geom.QuadCurve2D.Float(-3, -4, 4, -6, 0, -1);
        g2.draw(q);
        g2.fillOval(-1, 1, 2, 2);
        g2.fillOval(-1, 5, 2, 2);
    }

    /**
     * Generate a Perlin-noise greyscale texture tinted toward the given colors.
     * The OSRS login screen has a stony, noisy grey-brown appearance — this
     * reproduces that look. The noise varies between `dark` and `light` colors
     * based on the fractal noise value at each pixel.
     *
     * Auto-contrast: samples the noise first to find the actual min/max, then
     * normalizes to [0, 1] using that range — so the full dark→light color
     * range is used (stronger visual contrast).
     *
     * @param w      texture width
     * @param h      texture height
     * @param seed   noise seed (use the same seed across states for consistency)
     * @param light  color at noise = max
     * @param dark   color at noise = min
     */
    private static java.awt.image.BufferedImage generateNoiseTexture(int w, int h, long seed, Color light, Color dark) {
        PerlinNoise noise = new PerlinNoise(seed);

        // First pass: sample the noise to find the actual min/max (auto-contrast)
        double nMin = Double.MAX_VALUE, nMax = -Double.MAX_VALUE;
        double[][] noiseVals = new double[h][w];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                // 5 octaves for rougher, more detailed texture
                double n = noise.fractal(x, y, 5, 0.55, 0.22);
                noiseVals[y][x] = n;
                if (n < nMin) nMin = n;
                if (n > nMax) nMax = n;
            }
        }
        double nRange = Math.max(0.0001, nMax - nMin);

        // Second pass: map noise to color
        java.awt.image.BufferedImage img = new java.awt.image.BufferedImage(w, h, java.awt.image.BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                // Normalize to [0, 1] using actual range
                double t = (noiseVals[y][x] - nMin) / nRange;
                // No gamma — keep the full contrast
                int r = (int) (dark.getRed()   + (light.getRed()   - dark.getRed())   * t);
                int g = (int) (dark.getGreen() + (light.getGreen() - dark.getGreen()) * t);
                int b = (int) (dark.getBlue()  + (light.getBlue()  - dark.getBlue())  * t);
                img.setRGB(x, y, (r << 16) | (g << 8) | b);
            }
        }
        return img;
    }
}
