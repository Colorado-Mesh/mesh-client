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

/// A reserved rectangle reported to JS (`NativeRect` in `mobile/src/native/contracts.ts`): the
/// camera / Dynamic Island occlusion regions, in CSS px relative to the WebView.
struct MeshRect: Equatable {
    let left: Double
    let top: Double
    let right: Double
    let bottom: Double

    var dictionary: [String: Any] {
        ["left": left, "top": top, "right": right, "bottom": bottom]
    }
}

/// Folds and occlusion regions published together (`NativeFoldState`).
struct MeshReservedRegions: Equatable {
    let folds: [MeshFoldFeature]
    let occlusions: [MeshRect]

    var dictionary: [String: Any] {
        ["folds": folds.map(\.dictionary), "occlusions": occlusions.map(\.dictionary)]
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
    /// Called on the main thread whenever the reported folds or occlusion regions change.
    var onRegionsChanged: ((MeshReservedRegions) -> Void)?
    private var lastRegions = MeshReservedRegions(folds: [], occlusions: [])
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

    /// Active occlusion regions (camera, Dynamic Island) in CSS px. On the iPhone Duo outer
    /// display they sit at the top of the system side column, which tells the page where that
    /// column is and where its navigation may start. Main thread only.
    func currentOcclusions() -> [MeshRect] {
        #if compiler(>=6.4) && !MESH_NO_RESERVED_REGIONS
        if #available(iOS 27.1, *) {
            let zoom = max(Double(pageZoom), 0.01)
            return reservedRegions(kind: .occlusion, options: []).map { region in
                MeshRect(
                    left: Double(region.frame.minX) / zoom,
                    top: Double(region.frame.minY) / zoom,
                    right: Double(region.frame.maxX) / zoom,
                    bottom: Double(region.frame.maxY) / zoom
                )
            }
        }
        #endif
        return []
    }

    /// Folds and occlusion regions together. Main thread only.
    func currentRegions() -> MeshReservedRegions {
        MeshReservedRegions(folds: currentFolds(), occlusions: currentOcclusions())
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
        let regions = currentRegions()
        guard regions != lastRegions else { return }
        lastRegions = regions
        onRegionsChanged?(regions)
    }
}
