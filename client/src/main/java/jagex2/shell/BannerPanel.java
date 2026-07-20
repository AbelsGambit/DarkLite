package jagex2.shell;

import sign.signlink;

import java.awt.Color;
import java.awt.Cursor;
import java.awt.Dimension;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.Image;
import java.awt.RenderingHints;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.geom.AffineTransform;
import java.awt.geom.GeneralPath;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.InputStream;

import javax.imageio.ImageIO;
import javax.swing.JPanel;

/**
 * Jagex banner — loads the official Jagex banner image (jagex-banner.png)
 * from the classpath resources and draws it scaled to fit the panel.
 *
 * The image is 764×25; the panel is sized to match the game window width
 * (765px) and the image's natural height (scaled).
 */
public class BannerPanel extends JPanel {

    /** Banner height — matches the image aspect ratio when scaled to 765px wide. */
    public static final int HEIGHT = 25;

    private static BufferedImage bannerImage = null;
    private static boolean imageLoadAttempted = false;

    public BannerPanel() {
        setPreferredSize(new Dimension(765, HEIGHT));
        setMinimumSize(new Dimension(765, HEIGHT));
        setMaximumSize(new Dimension(Integer.MAX_VALUE, HEIGHT));
        setLayout(null);
        setOpaque(true);
        setBackground(new Color(0x5c, 0x43, 0x21));
        setDoubleBuffered(true);
        setCursor(Cursor.getDefaultCursor());

        // Load the banner image once
        if (!imageLoadAttempted) {
            imageLoadAttempted = true;
            try {
                // Try classpath first (works when bundled in JAR)
                InputStream is = BannerPanel.class.getResourceAsStream("/jagex-banner.png");
                if (is == null) {
                    // Fallback: try file system (works in dev)
                    File f = new File("src/main/resources/jagex-banner.png");
                    if (!f.exists()) f = new File("jagex-banner.png");
                    if (f.exists()) {
                        bannerImage = ImageIO.read(f);
                    }
                } else {
                    bannerImage = ImageIO.read(is);
                    is.close();
                }
            } catch (Exception e) {
                System.err.println("Failed to load jagex-banner.png: " + e);
            }
        }
    }

    @Override
    protected void paintComponent(Graphics g) {
        super.paintComponent(g);
        Graphics2D g2 = (Graphics2D) g.create();
        try {
            g2.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);

            int w = getWidth();
            int h = getHeight();

            if (bannerImage != null) {
                // Draw the banner image scaled to fit the panel width
                g2.drawImage(bannerImage, 0, 0, w, h, null);
            } else {
                // Fallback: brown gradient if image failed to load
                g2.setPaint(new java.awt.GradientPaint(0, 0, new Color(0x9a, 0x7a, 0x45),
                        0, h, new Color(0x4a, 0x35, 0x17)));
                g2.fillRect(0, 0, w, h);
            }
        } finally {
            g2.dispose();
        }
    }
}
