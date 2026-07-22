package jagex2.shell;

import java.awt.BorderLayout;
import java.awt.CardLayout;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.Font;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;

import javax.swing.BorderFactory;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import javax.swing.JSlider;
import javax.swing.BoxLayout;
import javax.swing.Box;
import javax.swing.Timer;

/**
 * Slide-out leaflet area (186px wide) on the right side of the game window.
 * One leaflet visible at a time. Toggling a leaflet slides it in/out horizontally.
 *
 * The leaflet slides out from the LEFT edge of the leaflet area — i.e. it appears
 * to emerge from the right side of the side button column.
 *
 * Contains 5 leaflets: settings, worlds, friends, notes, help.
 */
public class LeafletArea extends JPanel {

    public static final int WIDTH = 210;

    private final CardLayout cards;
    private final JPanel cardHolder;
    private final Timer slideTimer;

    // Slide state machine:
    //   direction = +1 : sliding IN  (progress 0 -> 100)
    //                       leaflet moves from x = -WIDTH (off-screen left, behind buttons)
    //                       to x = 0 (in place)
    //   direction = -1 : sliding OUT (progress 100 -> 0)
    //                       leaflet moves from x = 0 back to x = -WIDTH
    //   direction = 0  : idle
    //
    // Sliding from the LEFT edge makes the leaflet appear to emerge from the right
    // side of the side button column (which is immediately to the left of this area).
    private int slideDirection = 0;
    private int slideProgress = 0;     // 0 = closed (off-screen left), 100 = open (in place)
    private String currentLeaflet = null;  // leaflet currently visible (or being slid in)
    private String pendingLeaflet = null;  // leaflet to show after slide-out completes

    public LeafletArea() {
        setPreferredSize(new Dimension(WIDTH, 543));
        setMinimumSize(new Dimension(WIDTH, 543));
        setMaximumSize(new Dimension(WIDTH, Integer.MAX_VALUE));
        setLayout(null);
        setOpaque(true);
        setBackground(new Color(0x1a, 0x14, 0x10));

        cards = new CardLayout();
        cardHolder = new JPanel(cards);
        cardHolder.setOpaque(false);
        cardHolder.setBounds(0, 0, WIDTH, 543);
        add(cardHolder);

        // Build the 5 leaflets
        cardHolder.add(buildSettingsLeaflet(), "settings");
        cardHolder.add(buildWorldsLeaflet(),   "worlds");
        cardHolder.add(buildFriendsLeaflet(),  "friends");
        cardHolder.add(buildNotesLeaflet(),    "notes");
        cardHolder.add(buildHelpLeaflet(),     "help");

        // All hidden initially (translated off-screen to the LEFT, so the leaflet
        // will appear to emerge from the right side of the button column when it slides in).
        cardHolder.setLocation(-WIDTH, 0);

        slideTimer = new Timer(15, new ActionListener() {
            @Override
            public void actionPerformed(ActionEvent e) {
                stepSlide();
            }
        });
    }

    /**
     * Show the named leaflet.
     *   - If no leaflet is open: slide it in from the right.
     *   - If a different leaflet is open: slide it out, then slide the new one in.
     *   - If the same leaflet is open: do nothing (toggle handled by SideButtonColumn).
     */
    public void showLeaflet(String id) {
        if (currentLeaflet == null) {
            // Nothing open — slide in directly
            currentLeaflet = id;
            cards.show(cardHolder, id);
            slideProgress = 0;
            slideDirection = +1;
            if (!slideTimer.isRunning()) slideTimer.start();
        } else if (!id.equals(currentLeaflet)) {
            // Different leaflet open — set pending; slide-out will trigger slide-in of the new one
            pendingLeaflet = id;
            slideDirection = -1;
            if (!slideTimer.isRunning()) slideTimer.start();
        }
    }

    /** Hide any open leaflet (slides out to the right). */
    public void hideLeaflet() {
        if (currentLeaflet != null && slideDirection != -1) {
            pendingLeaflet = null;
            slideDirection = -1;
            if (!slideTimer.isRunning()) slideTimer.start();
        }
    }

    /** Convenience: hide the current leaflet, then show a new one. */
    public void hideThenShow(String nextId) {
        showLeaflet(nextId);
    }

    private void stepSlide() {
        if (slideDirection == +1) {
            // Sliding in: from x = -WIDTH (progress=0) to x = 0 (progress=100)
            slideProgress = Math.min(100, slideProgress + 14);
            int x = -WIDTH + (WIDTH * slideProgress / 100);
            cardHolder.setLocation(x, 0);
            if (slideProgress >= 100) {
                slideDirection = 0;
                slideTimer.stop();
            }
        } else if (slideDirection == -1) {
            // Sliding out: from x = 0 (progress=100) back to x = -WIDTH (progress=0)
            slideProgress = Math.max(0, slideProgress - 14);
            int x = -WIDTH + (WIDTH * slideProgress / 100);
            cardHolder.setLocation(x, 0);
            if (slideProgress <= 0) {
                slideDirection = 0;
                slideTimer.stop();
                currentLeaflet = null;
                if (pendingLeaflet != null) {
                    // Slide in the pending leaflet
                    String next = pendingLeaflet;
                    pendingLeaflet = null;
                    showLeaflet(next);
                }
            }
        }
    }

    // ---- Leaflet content builders ----

    private static final Color LEAFLET_BG = new Color(0x2c, 0x24, 0x18);
    private static final Color LEAFLET_BG2 = new Color(0x1e, 0x18, 0x10);
    private static final Color GOLD = new Color(0xff, 0xd2, 0x4a);
    private static final Color CREAM = new Color(0xf5, 0xe6, 0xc8);
    private static final Color TAN = new Color(0xc8, 0xb8, 0x90);
    private static final Font H3_FONT = new Font("Segoe UI", Font.BOLD, 12);
    private static final Font BODY_FONT = new Font("Segoe UI", Font.PLAIN, 11);
    private static final Font SMALL_FONT = new Font("Segoe UI", Font.PLAIN, 10);

    private JPanel buildLeafletBase(String title) {
        JPanel p = new JPanel() {
            @Override
            protected void paintComponent(Graphics g) {
                Graphics2D g2 = (Graphics2D) g.create();
                try {
                    g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                    g2.setPaint(new java.awt.GradientPaint(0, 0, LEAFLET_BG, 0, getHeight(), LEAFLET_BG2));
                    g2.fillRect(0, 0, getWidth(), getHeight());
                    // Left edge highlight
                    g2.setColor(new Color(0x6a, 0x52, 0x32));
                    g2.fillRect(0, 0, 1, getHeight());
                    g2.setColor(new Color(0, 0, 0, 100));
                    g2.fillRect(2, 0, 1, getHeight());
                } finally {
                    g2.dispose();
                }
                super.paintComponent(g);
            }
        };
        p.setOpaque(false);
        p.setLayout(new BorderLayout(0, 6));
        p.setBorder(BorderFactory.createEmptyBorder(8, 6, 8, 6));

        JLabel h = new JLabel(title, JLabel.CENTER);
        h.setForeground(GOLD);
        h.setFont(H3_FONT);
        p.add(h, BorderLayout.NORTH);
        return p;
    }

    private JPanel buildSettingsLeaflet() {
        JPanel p = buildLeafletBase("Settings");
        JPanel body = new JPanel();
        body.setOpaque(false);
        body.setLayout(new BoxLayout(body, BoxLayout.Y_AXIS));
        body.setAlignmentX(LEFT_ALIGNMENT);

        String[] labels = { "Brightness", "Volume", "Music" };
        for (String label : labels) {
            JLabel l = new JLabel(label);
            l.setForeground(TAN);
            l.setFont(BODY_FONT);
            l.setAlignmentX(LEFT_ALIGNMENT);
            body.add(l);
            body.add(Box.createVerticalStrut(2));
            JSlider s = new JSlider(0, 100, 60);
            s.setAlignmentX(LEFT_ALIGNMENT);
            s.setMaximumSize(new Dimension(WIDTH - 16, 24));
            s.setOpaque(false);
            body.add(s);
            body.add(Box.createVerticalStrut(6));
        }
        JLabel note = new JLabel("<html><div style='text-align:center;'>Adjust client options.<br>Changes are local only.</div></html>");
        note.setForeground(new Color(0x8a, 0x7a, 0x5a));
        note.setFont(SMALL_FONT);
        note.setAlignmentX(LEFT_ALIGNMENT);
        body.add(note);
        p.add(body, BorderLayout.CENTER);
        return p;
    }

    private JPanel buildWorldsLeaflet() {
        JPanel p = buildLeafletBase("Worlds");
        JPanel body = new JPanel();
        body.setOpaque(false);
        body.setLayout(new BoxLayout(body, BoxLayout.Y_AXIS));
        body.setAlignmentX(LEFT_ALIGNMENT);

        String[][] worlds = {
            {"World 301", "42ms"},
            {"World 302", "58ms"},
            {"World 303", "71ms"},
            {"World 304", "89ms"},
            {"World 305", "102ms"},
            {"World 306", "44ms"},
        };
        for (String[] w : worlds) {
            JPanel row = new JPanel(new BorderLayout());
            row.setOpaque(false);
            row.setMaximumSize(new Dimension(WIDTH - 16, 20));
            JLabel name = new JLabel(w[0]);
            name.setForeground(CREAM);
            name.setFont(BODY_FONT);
            JLabel ping = new JLabel(w[1], JLabel.RIGHT);
            ping.setForeground(new Color(0x8a, 0xa8, 0x6a));
            ping.setFont(SMALL_FONT);
            row.add(name, BorderLayout.WEST);
            row.add(ping, BorderLayout.EAST);
            body.add(row);
            body.add(Box.createVerticalStrut(3));
        }
        p.add(body, BorderLayout.CENTER);
        return p;
    }

    private JPanel buildFriendsLeaflet() {
        JPanel p = buildLeafletBase("Friends");
        JPanel body = new JPanel();
        body.setOpaque(false);
        body.setLayout(new BoxLayout(body, BoxLayout.Y_AXIS));
        body.setAlignmentX(LEFT_ALIGNMENT);

        String[][] friends = {
            {"Zezima", "online"},
            {"N0valyfe", "online"},
            {"The Old Nite", "offline"},
            {"Lilyuffie88", "offline"},
            {"Green098", "online"},
        };
        for (String[] f : friends) {
            JPanel row = new JPanel(new BorderLayout());
            row.setOpaque(false);
            row.setMaximumSize(new Dimension(WIDTH - 16, 18));
            JLabel name = new JLabel(f[0]);
            name.setForeground(CREAM);
            name.setFont(BODY_FONT);
            JLabel status = new JLabel(f[1].equals("online") ? "\u2022" : "\u25cb", JLabel.RIGHT);
            status.setForeground(f[1].equals("online") ? new Color(0x8a, 0xa8, 0x6a) : new Color(0x66, 0x66, 0x66));
            status.setFont(new Font("Segoe UI", Font.BOLD, 12));
            row.add(name, BorderLayout.WEST);
            row.add(status, BorderLayout.EAST);
            body.add(row);
            body.add(Box.createVerticalStrut(3));
        }
        JLabel legend = new JLabel("\u2022 online  \u25cb offline");
        legend.setForeground(new Color(0x8a, 0x7a, 0x5a));
        legend.setFont(SMALL_FONT);
        legend.setAlignmentX(LEFT_ALIGNMENT);
        body.add(Box.createVerticalStrut(6));
        body.add(legend);
        p.add(body, BorderLayout.CENTER);
        return p;
    }

    private JPanel buildNotesLeaflet() {
        JPanel p = buildLeafletBase("Notes");
        JTextArea ta = new JTextArea();
        ta.setBackground(new Color(0x0e, 0x0a, 0x06));
        ta.setForeground(CREAM);
        ta.setCaretColor(CREAM);
        ta.setFont(new Font("Monospaced", Font.PLAIN, 10));
        ta.setBorder(BorderFactory.createEmptyBorder(4, 4, 4, 4));
        p.add(ta, BorderLayout.CENTER);
        return p;
    }

    private JPanel buildHelpLeaflet() {
        JPanel p = buildLeafletBase("Help");
        JPanel body = new JPanel();
        body.setOpaque(false);
        body.setLayout(new BoxLayout(body, BoxLayout.Y_AXIS));
        body.setAlignmentX(LEFT_ALIGNMENT);

        String[] topics = {"Getting Started", "Controls", "Combat Guide", "Quest Help", "Skill Guide", "Contact Support"};
        for (String t : topics) {
            JLabel l = new JLabel(t);
            l.setForeground(TAN);
            l.setFont(BODY_FONT);
            l.setAlignmentX(LEFT_ALIGNMENT);
            body.add(l);
            body.add(Box.createVerticalStrut(3));
        }
        JLabel note = new JLabel("Click a topic for more info.");
        note.setForeground(new Color(0x8a, 0x7a, 0x5a));
        note.setFont(SMALL_FONT);
        note.setAlignmentX(LEFT_ALIGNMENT);
        body.add(Box.createVerticalStrut(6));
        body.add(note);
        p.add(body, BorderLayout.CENTER);
        return p;
    }
}
