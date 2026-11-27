import UIKit
import WebKit

/// One fold reported to JS (`NativeFoldFeature` in `mobile/src/native/contracts.ts`), in CSS px
/// relative to the WebView.
struct MeshFoldFeature: Equatable {
    let left: Double
    let top: Double
    let right: Double
    let bottom: Double
    let vertical: Bool
    let active: Bool

    var dictionary: [String: Any] {
        [
            "left": left,
            "top": top,
            "right": right,
            "bottom": bottom,
            // A fold taller than wide is a vertical hinge line: side-by-side panes (book posture).
            "orientation": vertical ? "vertical" : "horizontal",
            "state": active ? "half-opened" : "flat",
            "separating": active,
        ]
    }
}

/// The Capacitor WebView (returned from `MainViewController.webView(with:configuration:)`).
///
/// WKWebView exposes no fold or posture API to the page (no Viewport Segments / Device Posture),
/// so the fold comes from UIKit: on iPhone Duo, iOS 27.1 reports the hinge as a `division`
/// reserved region, active only while the device is partially open ("Preparing your app for
/// iPhone Duo"). The API exists only in the iOS 27.1 SDK (Xcode 27.1+, Swift 6.4+); older
/// toolchains, or Xcode 27.0 which also ships Swift 6.4 but not the API (`mesh.xcconfig` sets
/// `MESH_NO_RESERVED_REGIONS` there), compile the empty fallback and report no folds.
final class MeshWebView: WKWebView {
    /// Called on the main thread whenever the reported folds change.
    var onFoldsChanged: (([MeshFoldFeature]) -> Void)?
    private var lastFolds: [MeshFoldFeature] = []
    private var lastSize: CGSize = .zero

    // Makes UIKit run updateConstraints(), where reserved-region reads are tracked.
    override class var requiresConstraintBasedLayout: Bool { true }

    /// Division (fold) regions in CSS px, active (partially open) ones first. Main thread only.
    func currentFolds() -> [MeshFoldFeature] {
        #if compiler(>=6.4) && !MESH_NO_RESERVED_REGIONS
        if #available(iOS 27.1, *) {
            // CSS px = points / page zoom (contentInset is "never", so the page origin is the
            // view origin and the frame needs no offset).
            let zoom = max(Double(pageZoom), 0.01)
            let folds = reservedRegions(kind: .division, options: .includeInactive).map { region in
                MeshFoldFeature(
                    left: Double(region.frame.minX) / zoom,
                    top: Double(region.frame.minY) / zoom,
                    right: Double(region.frame.maxX) / zoom,
                    bottom: Double(region.frame.maxY) / zoom,
                    vertical: region.frame.height >= region.frame.width,
                    active: region.isActive
                )
            }
            return folds.sorted { $0.active && !$1.active }
        }
        #endif
        return []
    }

    override func updateConstraints() {
        // "UIKit tracks the regions you read in updateConstraints() and runs it again when the
        // regions change" (UIView.reservedRegions(kind:options:)), e.g. when the Duo folds.
        publishFolds()
        super.updateConstraints()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if bounds.size != lastSize {
            // Rotation / display switch: frames move with the view.
            lastSize = bounds.size
            setNeedsUpdateConstraints()
            publishFolds()
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        setNeedsUpdateConstraints()
    }

    private func publishFolds() {
        let folds = currentFolds()
        guard folds != lastFolds else { return }
        lastFolds = folds
        onFoldsChanged?(folds)
    }
}
