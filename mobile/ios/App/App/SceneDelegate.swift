import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // UISceneStoryboardFile (Main) has already created a window whose root is
        // MainViewController; reuse it so only one Capacitor bridge (and one host worker) exists.
        // Fall back to creating the controller in code if the storyboard was not used.
        if let window, window.rootViewController is MainViewController {
            window.backgroundColor = MainViewController.backgroundColor
            window.makeKeyAndVisible()
        } else {
            let window = UIWindow(windowScene: windowScene)
            window.backgroundColor = MainViewController.backgroundColor
            window.rootViewController = MainViewController()
            window.makeKeyAndVisible()
            self.window = window
        }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
