package jagex2.client;

import jagex2.config.Component;

/**
 * Debug utility — dumps all type-5 (sprite button) components that have
 * toggle scripts (scripts[0][0] == 5). These are the toggle buttons like
 * run, music volume, accept aid, etc.
 *
 * Run by typing ::dumpsprites in the game chat.
 * Output goes to System.out (the console/terminal).
 *
 * Filtered to only show toggle buttons so the output fits in the console.
 */
public class ComponentSpriteDumper {

    public static void dump() {
        System.out.println("=== Toggle Button Sprite Dump (type 5 with scripts[0][0]==5) ===");
        int count = 0;
        try {
            for (int i = 0; i < Component.types.length; i++) {
                if (Component.types[i] == null) continue;
                Component c = Component.get(i);
                if (c == null) continue;
                if (c.type != 5) continue;
                // Only show components with toggle scripts
                if (c.scripts == null || c.scripts.length == 0 || c.scripts[0].length < 2) continue;
                if (c.scripts[0][0] != 5) continue;

                String gName = (c.graphic != null)
                    ? "graphic(w=" + c.graphic.wi + ",h=" + c.graphic.hi + " name='" + (c.graphicName != null ? c.graphicName : "") + "')"
                    : "graphic=null";
                String agName = (c.activeGraphic != null)
                    ? "activeGraphic(w=" + c.activeGraphic.wi + ",h=" + c.activeGraphic.hi + " name='" + (c.activeGraphicName != null ? c.activeGraphicName : "") + "')"
                    : "activeGraphic=null";
                String option = (c.option != null) ? c.option : "null";
                String scripts = "[" + c.scripts[0][0] + "," + c.scripts[0][1] + "]";
                String operand = (c.scriptOperand != null && c.scriptOperand.length > 0)
                    ? ("operand=" + c.scriptOperand[0])
                    : "operand=none";
                System.out.println("  comp[" + i + "] option='" + option + "' " + gName + " " + agName
                    + " scripts=" + scripts + " " + operand + " w=" + c.width + " h=" + c.height);
                count++;
            }
        } catch (Exception e) {
            System.out.println("  dump error: " + e);
        }
        System.out.println("=== Total toggle buttons: " + count + " ===");
    }
}
