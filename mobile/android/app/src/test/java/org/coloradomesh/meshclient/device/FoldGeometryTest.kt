package org.coloradomesh.meshclient.device

import org.junit.Assert.assertEquals
import org.junit.Test

class FoldGeometryTest {
    @Test
    fun convertsWindowPixelsToCssPixelsRelativeToTheWebView() {
        // Pixel Fold-like hinge: vertical, 0 px wide at x=1080 (window px), density 2.625,
        // WebView inset by a 63 px status bar at the top.
        val f = FoldGeometry.toCss(1080, 0, 1080, 2092, webViewX = 0, webViewY = 63, density = 2.625f, vertical = true, halfOpened = false, separating = false)
        assertEquals(411.43, f.left, 0.001)
        assertEquals(411.43, f.right, 0.001)
        assertEquals(-24.0, f.top, 0.001)
        assertEquals(772.95, f.bottom, 0.001)
        assertEquals("vertical", f.orientation)
        assertEquals("flat", f.state)
        assertEquals(false, f.separating)
    }

    @Test
    fun reportsHorizontalHalfOpenedSeparatingHinges() {
        val f = FoldGeometry.toCss(0, 1000, 2000, 1060, webViewX = 100, webViewY = 40, density = 2f, vertical = false, halfOpened = true, separating = true)
        assertEquals(-50.0, f.left, 0.0)
        assertEquals(480.0, f.top, 0.0)
        assertEquals(950.0, f.right, 0.0)
        assertEquals(510.0, f.bottom, 0.0)
        assertEquals("horizontal", f.orientation)
        assertEquals("half-opened", f.state)
        assertEquals(true, f.separating)
        assertEquals(
            mapOf("left" to -50.0, "top" to 480.0, "right" to 950.0, "bottom" to 510.0, "orientation" to "horizontal", "state" to "half-opened", "separating" to true),
            f.toMap(),
        )
    }

    @Test
    fun zeroDensityFallsBackToOne() {
        assertEquals(10.0, FoldGeometry.toCss(10, 0, 10, 0, 0, 0, 0f, true, false, false).left, 0.0)
    }

    @Test
    fun equalGeometryCompareEqualSoNoDuplicateEventsAreSent() {
        val a = FoldGeometry.toCss(1080, 0, 1080, 2092, 0, 63, 2.625f, true, false, false)
        val b = FoldGeometry.toCss(1080, 0, 1080, 2092, 0, 63, 2.625f, true, false, false)
        assertEquals(a, b)
    }
}
