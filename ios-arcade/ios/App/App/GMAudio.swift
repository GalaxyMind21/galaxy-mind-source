import AVFoundation

/// Ambient playback follows the hardware silent switch. WebAudio can
/// flip the session to playback after the first gesture, so the shell
/// asks again a moment later.
enum GMAudio {
    static func applyAmbient() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
        try? session.setActive(true)
    }
}
