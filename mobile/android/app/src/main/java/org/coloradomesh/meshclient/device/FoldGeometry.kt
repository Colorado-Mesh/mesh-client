package org.coloradomesh.meshclient.device

import kotlin.math.roundToInt

/** A fold / hinge in the contract shape (`NativeFoldFeature`): CSS px relative to the WebView. */
data class CssFold(
    val left: Double,
    val top: Double,
    val right: Double,
    val bottom: Double,
    val orientation: String,
    val state: String,
    val separating: Boolean,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "left" to left,
        "top" to top,
        "right" to right,
        "bottom" to bottom,
        "orientation" to orientation,
        "state" to state,
        "separating" to separating,
    )
}

/** Pure geometry for `MeshDevice` fold reporting (unit-tested on the JVM). */
object FoldGeometry {
    /**
     * Window-space physical px bounds (Jetpack `FoldingFeature.bounds`) -> CSS px relative to the
     * WebView: subtract the WebView's location in the window, divide by the display density.
     * Values are rounded to 1/100 px so tiny float noise does not trigger change events.
     */
    fun toCss(
        boundsLeft: Int,
        boundsTop: Int,
        boundsRight: Int,
        boundsBottom: Int,
        webViewX: Int,
        webViewY: Int,
        density: Float,
        vertical: Boolean,
        halfOpened: Boolean,
        separating: Boolean,
    ): CssFold {
        val d = if (density > 0f) density.toDouble() else 1.0
        fun css(px: Int, offset: Int): Double = ((px - offset) / d * 100.0).roundToInt() / 100.0
        return CssFold(
            left = css(boundsLeft, webViewX),
            top = css(boundsTop, webViewY),
            right = css(boundsRight, webViewX),
            bottom = css(boundsBottom, webViewY),
            orientation = if (vertical) "vertical" else "horizontal",
            state = if (halfOpened) "half-opened" else "flat",
            separating = separating,
        )
    }
}
