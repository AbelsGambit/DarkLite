package jagex2.graphics;

import java.awt.Component;
import java.awt.image.DirectColorModel;
import java.awt.image.ImageConsumer;

/**
 * A PixMap with alpha support. Pixel value 0 = transparent.
 *
 * Works EXACTLY like PixMap — same ImageProducer pipeline, same draw().
 * The only difference: the color model includes alpha, so pixel 0 renders
 * as transparent instead of black.
 */
public class AlphaPixMap extends PixMap {

    private static final java.awt.image.ColorModel ALPHA_CM =
        new DirectColorModel(32, 0x00FF0000, 0x0000FF00, 0x000000FF, 0xFF000000);

    public AlphaPixMap(int height, Component c, int width) {
        super(height, c, width);
        // Replace the color model and re-push to the consumer
        this.colorModel = ALPHA_CM;
        if (this.consumer != null) {
            this.consumer.setColorModel(ALPHA_CM);
        }
        this.setPixels();
        c.prepareImage(this.image, this);
        this.setPixels();
    }

    @Override
    public synchronized void addConsumer(ImageConsumer c) {
        this.consumer = c;
        c.setDimensions(this.width, this.height);
        c.setProperties(null);
        c.setColorModel(ALPHA_CM);
        c.setHints(14);
    }
}
