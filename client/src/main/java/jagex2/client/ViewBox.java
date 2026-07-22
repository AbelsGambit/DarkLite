package jagex2.client;

import jagex2.shell.BannerPanel;
import jagex2.shell.LeafletArea;
import jagex2.shell.SideButtonColumn;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.Insets;

import javax.swing.BorderFactory;
import javax.swing.BoxLayout;
import javax.swing.JFrame;
import javax.swing.JPanel;
import javax.swing.SwingUtilities;

import deob.ObfuscatedName;
import sign.signlink;

/**
 * Top-level client window.
 *
 * Revised layout:
 *
 *   ┌──────────────────────────────────────┐
 *   │       black spacer (top, 20px)       │
 *   │  ┌──────────────────────────────────┐│
 *   │  │ 1px grey border                  ││
 *   │  │ 1px brown border                 ││
 *   │  │  ┌──────────────────────────┐    ││
 *   │  │  │      Banner              │    ││
 *   │  │  ├──────────────────────────┤    ││  ← banner touches game (no border between)
 *   │  │  │      Game Canvas         │    ││
 *   │  │  │      (765×503)           │    ││
 *   │  │  └──────────────────────────┘    ││
 *   │  │ 1px brown border                 ││
 *   │  │ 1px grey border                  ││
 *   │  └──────────────────────────────────┘│
 *   │       black spacer (bottom, 20px)    │
 *   │                            ┌──┬─────┐│
 *   │                            │SB│Leaf ││
 *   │                            │  │     ││
 *   │                            └──┴─────┘│
 *   └──────────────────────────────────────┘
 *
 *   - Banner + game canvas are treated as ONE combined object.
 *   - The 2px detail border (1px grey + 1px brown) wraps around the combined object.
 *   - Black spacers above and below (equal height, 20px each) so the banner
 *     doesn't touch the title bar and the game doesn't touch the window bottom.
 *   - Side button column is ALMOST touching the combined object (1px gap).
 *   - Leaflet area is to the right of the buttons (186px wide, slides from left).
 *
 * The GameShell (Applet) is NOT modified.
 */
public class ViewBox extends JFrame {

    @ObfuscatedName("IEJCKZCR.a")
    public GameShell shell;

    public Insets insets;

    private BannerPanel banner;
    private SideButtonColumn sideButtons;
    private LeafletArea leafletArea;
    private CombinedPanel combinedPanel; // banner + game as one object with layered border

    // Border colors for the 2 detail borders around the combined banner+game object
    private static final Color BROWN_BORDER = new Color(0x3a, 0x2a, 0x14);       // dark brown
    private static final Color GREY_WHITE_BORDER = new Color(0x6a, 0x6a, 0x66);  // grey/white tint
    private static final int SPACER = 4;          // black spacer height (top + bottom + sides) — reduced from 8
    private static final int SIDE_GAP = 0;         // gap between combined game object and side button column (touching the 4px padding)

    public ViewBox(int height, GameShell shell, int width) {
        this.shell = shell;
        this.setTitle("RuneScape - release #" + signlink.clientversion);
        this.setResizable(false);

        this.setLayout(new BorderLayout(0, 0));
        this.getContentPane().setBackground(Color.BLACK);

        // ---- Combined panel: banner + game canvas with layered border around both ----
        combinedPanel = new CombinedPanel(shell, width, height, BROWN_BORDER, GREY_WHITE_BORDER);

        // ---- Side button column (full height of the combined panel including spacers) ----
        sideButtons = new SideButtonColumn();
        int sideHeight = combinedPanel.getPreferredSize().height;
        sideButtons.setPreferredSize(new Dimension(SideButtonColumn.COLUMN_WIDTH, sideHeight));

        // ---- Leaflet area (132px wide, full height) ----
        leafletArea = new LeafletArea();
        leafletArea.setPreferredSize(new Dimension(LeafletArea.WIDTH, sideHeight));

        // ---- Assemble the main row ----
        // Left: combined panel (banner + game with border + spacers)
        // 3px gap
        // Right: side buttons (WEST) + 2px gap + leaflet area (CENTER)
        JPanel rightColumn = new JPanel(new BorderLayout(2, 0));
        rightColumn.setOpaque(true);
        rightColumn.setBackground(Color.BLACK);
        rightColumn.add(sideButtons, BorderLayout.WEST);
        rightColumn.add(leafletArea, BorderLayout.CENTER);

        JPanel mainRow = new JPanel(new BorderLayout(SIDE_GAP, 0));
        mainRow.setOpaque(true);
        mainRow.setBackground(Color.BLACK);
        mainRow.add(combinedPanel, BorderLayout.WEST);
        mainRow.add(rightColumn, BorderLayout.CENTER);

        this.add(mainRow, BorderLayout.CENTER);

        // Wire side buttons to leaflet toggle
        sideButtons.addListener((id, open) -> {
            SwingUtilities.invokeLater(() -> {
                if (open) {
                    leafletArea.hideThenShow(id);
                } else {
                    leafletArea.hideLeaflet();
                }
            });
        });

        this.pack();
        this.setLocationRelativeTo(null);

        shell.setVisible(true);
        shell.validate();
        this.validate();
        this.repaint();

        this.setVisible(true);
        this.toFront();

        SwingUtilities.invokeLater(() -> {
            banner.repaint();
            sideButtons.repaint();
            leafletArea.repaint();
            combinedPanel.repaint();
        });
    }

    public void update(Graphics g) {
        super.update(g);
    }

    public void paint(Graphics g) {
        super.paint(g);
    }

    /**
     * Panel that treats the banner + game canvas as one combined object.
     *
     * Layout (inside the panel):
     *   - SPACER px black border (top)
     *   - banner (full width = canvasW, NO border around it)
     *   - game canvas with 2px detail border on left/right/bottom only
     *     (border does NOT wrap the top of the game — the banner touches
     *     the game directly with no border between them)
     *   - SPACER px black border (bottom)
     *
     * The SPACER also applies to left and right sides.
     * The banner and game canvas share the same width (game width).
     */
    private class CombinedPanel extends JPanel {
        private final Component applet;
        private final int canvasW;
        private final int canvasH;
        private final Color brownColor;
        private final Color greyWhiteColor;

        CombinedPanel(Component applet, int canvasW, int canvasH, Color brown, Color greyWhite) {
            this.applet = applet;
            this.canvasW = canvasW;
            this.canvasH = canvasH;
            this.brownColor = brown;
            this.greyWhiteColor = greyWhite;
            setOpaque(true);
            setBackground(Color.BLACK);
            setLayout(new BorderLayout(0, 0));

            // ---- Banner (full width, NO border) ----
            banner = new BannerPanel();
            banner.setPreferredSize(new Dimension(canvasW, BannerPanel.HEIGHT));
            banner.setOpaque(true);
            banner.setBackground(Color.BLACK);

            // ---- Game canvas wrapped with a border on left/right/bottom only ----
            // The border does NOT wrap the top of the game — the banner sits
            // directly above the game with no border between them.
            JPanel borderedGame = new JPanel(new BorderLayout()) {
                @Override
                public void paint(Graphics g) {
                    super.paint(g);
                    Graphics2D g2 = (Graphics2D) g.create();
                    try {
                        int w = getWidth(), h = getHeight();

                        // Bottom border: full width, 2px tall (brown outer, grey inner)
                        g2.setColor(brownColor);
                        g2.drawLine(0, h - 1, w - 1, h - 1);
                        g2.setColor(greyWhiteColor);
                        g2.drawLine(1, h - 2, w - 2, h - 2);

                        // Left border: full height, 2px wide
                        g2.setColor(brownColor);
                        g2.drawLine(0, 0, 0, h - 1);
                        g2.setColor(greyWhiteColor);
                        g2.drawLine(1, 1, 1, h - 2);

                        // Right border: full height, 2px wide
                        g2.setColor(brownColor);
                        g2.drawLine(w - 1, 0, w - 1, h - 1);
                        g2.setColor(greyWhiteColor);
                        g2.drawLine(w - 2, 1, w - 2, h - 2);

                        // NO top border — banner touches game directly.
                    } finally {
                        g2.dispose();
                    }
                }
            };
            borderedGame.setOpaque(true);
            borderedGame.setBackground(Color.BLACK);
            borderedGame.setLayout(new BorderLayout());
            // 2px padding on left, right, bottom (for the border). No top padding.
            borderedGame.setBorder(BorderFactory.createEmptyBorder(0, 2, 2, 2));
            borderedGame.add(applet, BorderLayout.CENTER);

            // ---- Stack: banner on top, bordered game below ----
            JPanel stack = new JPanel(new BorderLayout(0, 0));
            stack.setOpaque(true);
            stack.setBackground(Color.BLACK);
            stack.add(banner, BorderLayout.NORTH);
            stack.add(borderedGame, BorderLayout.CENTER);

            // Outer spacers
            setBorder(BorderFactory.createEmptyBorder(SPACER, SPACER, SPACER, SPACER));
            add(stack, BorderLayout.CENTER);

            // Size: canvasW + 2px border each side + SPACER each side
            int horizExtra = (2 + SPACER) * 2;
            // Height: banner + canvas + 2px bottom border + SPACER * 2
            int vertExtra = 2 + SPACER * 2;
            setPreferredSize(new Dimension(canvasW + horizExtra, BannerPanel.HEIGHT + canvasH + vertExtra));
            setMinimumSize(getPreferredSize());
        }
    }
}
