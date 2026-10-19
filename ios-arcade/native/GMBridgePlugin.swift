import Capacitor
import GameKit
import SafariServices
import StoreKit

@objc(GMBridgePlugin)
public class GMBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GMBridgePlugin"
    public let jsName = "GMBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openExternal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAmbient", returnType: CAPPluginReturnPromise),
    ]

    private let allowHosts: Set<String> = [
        "galaxymind.space",
        "www.galaxymind.space",
        "x.com",
        "twitter.com",
        "mobile.twitter.com",
    ]

    @objc func keepAmbient(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            GMAudio.applyAmbient()
            call.resolve()
        }
    }

    @objc func requestReview(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let scene = self.bridge?.viewController?.view.window?.windowScene {
                SKStoreReviewController.requestReview(in: scene)
            }
            call.resolve()
        }
    }

    @objc func openExternal(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"),
              let url = URL(string: raw),
              let host = url.host?.lowercased(),
              url.scheme == "https",
              allowHosts.contains(host) else {
            call.reject("blocked")
            return
        }
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("no view")
                return
            }
            let safari = SFSafariViewController(url: url)
            safari.modalPresentationStyle = .pageSheet
            presenter.present(safari, animated: true)
            call.resolve()
        }
    }

    /// No-op unless Info.plist GMGameCenterEnabled is true. The
    /// entitlement stays off until App Store Connect leaderboards exist.
    @objc func submitScore(_ call: CAPPluginCall) {
        let flag = Bundle.main.object(forInfoDictionaryKey: "GMGameCenterEnabled")
        let enabled = (flag as? Bool) == true || (flag as? NSNumber)?.boolValue == true
        guard enabled else {
            call.resolve(["skipped": true])
            return
        }
        guard let id = call.getString("leaderboardId"), !id.isEmpty else {
            call.resolve(["skipped": true])
            return
        }
        let score = call.getInt("score") ?? 0
        GKLeaderboard.submitScore(score, context: 0, player: GKLocalPlayer.local, leaderboardIDs: [id]) { error in
            if let error = error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }
}
