import UIKit
import WebKit
import Capacitor

/// Capacitor's stock router treats every URL with no file extension as the
/// single-page app and returns the root index.html. The menu's Play links
/// are directory URLs (`/bitcoin-kart/`), so WKWebView reloads the menu.
/// A directory that contains index.html is that game. Anything else stays
/// the menu.
struct GMLocalRouter: Router {
    var basePath: String = ""

    func route(for path: String) -> String {
        let pathUrl = URL(fileURLWithPath: path)
        if !pathUrl.pathExtension.isEmpty {
            return basePath + path
        }
        let trimmed = path.hasSuffix("/") && path.count > 1 ? String(path.dropLast()) : path
        if trimmed.isEmpty || trimmed == "/" {
            return basePath + "/index.html"
        }
        let nested = basePath + trimmed + "/index.html"
        if FileManager.default.fileExists(atPath: nested) {
            return nested
        }
        return basePath + "/index.html"
    }
}

class GMBridgeViewController: CAPBridgeViewController {
    /// Night Bench ground from galaxymind.space (--bg-base #12110F).
    /// The app icon stays its own mark. Launch, web view, and menu share
    /// this ground so the first frame matches the site.
    private let night = UIColor(red: 18.0 / 255.0, green: 17.0 / 255.0, blue: 15.0 / 255.0, alpha: 1)
    private var urlObservation: NSKeyValueObservation?

    override func router() -> Router {
        GMLocalRouter()
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(GMBridgePlugin())
        view.backgroundColor = night
        guard let webView else { return }
        webView.isOpaque = true
        webView.backgroundColor = night
        webView.scrollView.backgroundColor = night
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        urlObservation = webView.observe(\.url, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.applyOrientation() }
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        applyOrientation()
    }

    /// Light glyphs on the dark purple bar. DarkContent would draw black
    /// text on this background.
    override var preferredStatusBarStyle: UIStatusBarStyle {
        .lightContent
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        wantsLandscape ? .landscape : .portrait
    }

    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation {
        wantsLandscape ? .landscapeRight : .portrait
    }

    override var shouldAutorotate: Bool {
        true
    }

    /// Bitcoin Kart and Super Saylor play in landscape. The other cabinets
    /// and the menu stay portrait. Info.plist allows both; this narrows it.
    private var wantsLandscape: Bool {
        let path = webView?.url?.path ?? ""
        return path.hasPrefix("/bitcoin-kart") || path.hasPrefix("/super-saylor")
    }

    private func applyOrientation() {
        if #available(iOS 16.0, *) {
            setNeedsUpdateOfSupportedInterfaceOrientations()
            let mask: UIInterfaceOrientationMask = wantsLandscape ? .landscape : .portrait
            let prefs = UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: mask)
            view.window?.windowScene?.requestGeometryUpdate(prefs) { _ in }
        } else {
            let raw = wantsLandscape
                ? UIInterfaceOrientation.landscapeRight.rawValue
                : UIInterfaceOrientation.portrait.rawValue
            UIDevice.current.setValue(raw, forKey: "orientation")
            UIViewController.attemptRotationToDeviceOrientation()
        }
    }
}
