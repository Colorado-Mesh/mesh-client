import Capacitor
import UIKit
import WebKit

/// Root view controller (Main.storyboard's initial controller, also created by `SceneDelegate`).
///
/// Registers the app's own native plugins as instances ("Custom Native iOS Code" in the Capacitor
/// docs): they live in this target, not in an npm package, so `cap sync` cannot list them in
/// `packageClassList`. `MeshUsbSerial` is Android-only — iOS gives third-party apps no USB serial
/// access, and the web layer installs its serial polyfill only on Android.
///
/// Edge to edge: Capacitor makes the WKWebView the controller's root view, so it always fills
/// the window; `ios.contentInset: 'never'` turns off scroll-view inset adjustment, and the page
/// pads itself with `env(safe-area-inset-*)` (`viewport-fit=cover`). Extending under the iPhone
/// Duo status bar / camera column additionally requires building with Xcode 27 (iOS 27 SDK).
final class MainViewController: CAPBridgeViewController {
    /// Slate 900 (`#0f172a`), the app background, shown before the page paints.
    static let backgroundColor = UIColor(red: 15 / 255, green: 23 / 255, blue: 42 / 255, alpha: 1)

    private let devicePlugin = MeshDevicePlugin()

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        MeshWebView(frame: frame, configuration: configuration)
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(MeshNetPlugin())
        bridge?.registerPluginInstance(devicePlugin)
        bridge?.registerPluginInstance(MeshProcessPlugin())

        if let webView {
            // No white flash before the first paint (mobile/capacitor.config.ts sets no backgroundColor).
            webView.isOpaque = false
            webView.backgroundColor = Self.backgroundColor
            webView.scrollView.backgroundColor = Self.backgroundColor
            webView.underPageBackgroundColor = Self.backgroundColor
        }
        (webView as? MeshWebView)?.onFoldsChanged = { [weak plugin = devicePlugin] folds in
            plugin?.foldsDidChange(folds)
        }

        #if DEBUG
        if MeshSmokeProbe.isEnabled {
            bridge?.registerPluginInstance(MeshSmokeConsolePlugin())
            MeshSmokeProbe.shared.attach(to: webView)
        }
        #endif
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.backgroundColor
    }
}
