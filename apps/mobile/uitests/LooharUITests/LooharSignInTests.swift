import CryptoKit
import XCTest

/// Signs in to a Loohar staging tenant and opens the POS register, entirely through the app's own
/// interface. This is the signed-in half of the certification: the launch tests prove the app
/// renders and reaches its API, and this proves a person can actually work in it.
///
/// The tenant is supplied by the environment, never hard-coded, and is always a throwaway STAGING
/// tenant:
///   LOOHAR_EMAIL, LOOHAR_PASSWORD, LOOHAR_MFA_SECRET (base32), LOOHAR_POS_PIN
///
/// The authenticator code is computed here rather than passed in, because a TOTP code lives 30
/// seconds and typing through a web view can easily take longer than that. Passing a pre-generated
/// code made the test fail on timing rather than on behaviour.
final class LooharSignInTests: XCTestCase {

    private var bundleIdentifier: String {
        ProcessInfo.processInfo.environment["LOOHAR_APP_BUNDLE_ID"] ?? "com.loohar.pos"
    }

    private func requiredEnvironment(_ name: String) throws -> String {
        guard let value = ProcessInfo.processInfo.environment[name], !value.isEmpty else {
            throw XCTSkip("\(name) is not set; this test needs a throwaway staging tenant")
        }
        return value
    }

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    // MARK: - TOTP

    private func base32Decode(_ input: String) -> Data {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var bits = 0, value = 0
        var output = Data()
        for character in input.uppercased() where character != "=" {
            guard let index = alphabet.firstIndex(of: character) else { continue }
            value = (value << 5) | index
            bits += 5
            if bits >= 8 {
                output.append(UInt8(truncatingIfNeeded: value >> (bits - 8)))
                bits -= 8
            }
        }
        return output
    }

    private func totp(secret: String, at date: Date = Date()) -> String {
        let counter = UInt64(date.timeIntervalSince1970 / 30)
        var bigEndian = counter.bigEndian
        let message = Data(bytes: &bigEndian, count: MemoryLayout<UInt64>.size)
        let key = SymmetricKey(data: base32Decode(secret))
        let digest = Array(HMAC<Insecure.SHA1>.authenticationCode(for: message, using: key))
        let offset = Int(digest[digest.count - 1] & 0x0f)
        let binary = (Int(digest[offset] & 0x7f) << 24)
            | (Int(digest[offset + 1]) << 16)
            | (Int(digest[offset + 2]) << 8)
            | Int(digest[offset + 3])
        return String(format: "%06d", binary % 1_000_000)
    }

    // MARK: - Helpers

    private func attach(_ app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @discardableResult
    private func tap(_ app: XCUIApplication, label: String, timeout: TimeInterval = 45) -> Bool {
        let button = app.buttons[label]
        if button.waitForExistence(timeout: timeout) {
            button.tap()
            return true
        }
        let text = app.staticTexts[label]
        if text.exists {
            text.tap()
            return true
        }
        return false
    }

    /// Tapping a field inside a web view does not always hand it the keyboard: the keyboard raised by
    /// the previous field can still be up and swallow the tap, and XCUITest then fails with
    /// "Neither element nor any descendant has keyboard focus". So this waits for the field to
    /// actually hold focus, and falls back to a coordinate tap before giving up.
    private func type(_ app: XCUIApplication, _ element: XCUIElement, _ value: String,
                      file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 30), "field not reachable", file: file, line: line)

        // The keyboard raised by the previous field covers the lower half of the screen, and the
        // password field sits under it. Tapping the app's header first blurs the current field and
        // puts the keyboard away, so the next field is reachable.
        if app.keyboards.element.exists {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.06)).tap()
            _ = app.keyboards.element.waitForNonExistence(timeout: 5)
        }

        for attempt in 0..<4 {
            if attempt % 2 == 0 {
                element.tap()
            } else {
                element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            }
            guard app.keyboards.element.waitForExistence(timeout: 5) else { continue }

            // Type through the application: a web view's field often holds the keyboard without
            // XCUITest reporting focus on the element, and element.typeText then refuses.
            app.typeText(value)

            // Typing this way is fire-and-forget, so confirm it actually landed. A secure field
            // reports bullets rather than the text, so only emptiness can be checked there.
            let landed = element.value as? String ?? ""
            if element.elementType == .secureTextField ? !landed.isEmpty : landed == value { return }

            if app.keyboards.element.exists {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.06)).tap()
                _ = app.keyboards.element.waitForNonExistence(timeout: 5)
            }
        }
        XCTFail("text never landed in \(element.label.isEmpty ? "a field" : element.label)", file: file, line: line)
    }

    // MARK: - The workflow

    func testSignsInWithTwoFactorAndOpensTheRegister() throws {
        // The register is the POS app's surface; the Driver app has no till to open.
        try XCTSkipUnless(bundleIdentifier == "com.loohar.pos", "the register workflow is the POS app's")
        let email = try requiredEnvironment("LOOHAR_EMAIL")
        let password = try requiredEnvironment("LOOHAR_PASSWORD")
        let secret = try requiredEnvironment("LOOHAR_MFA_SECRET")
        let pin = try requiredEnvironment("LOOHAR_POS_PIN")

        let app = XCUIApplication(bundleIdentifier: bundleIdentifier)
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30))
        XCTAssertTrue(app.staticTexts["Sign in"].waitForExistence(timeout: 60), "the sign-in screen never appeared")

        let emailField = app.textFields.firstMatch
        type(app, emailField, email)
        // Typing goes through the application, so confirm it landed in the field it was meant for.
        XCTAssertEqual(emailField.value as? String, email, "the email did not land in the email field")
        // The password field will not take text from a tap in this web view: XCUITest reports no
        // keyboard focus, and typing lands nowhere. Moving focus with Tab from the email field is
        // what a person with a keyboard does, and the web view honours it.
        let passwordField = app.secureTextFields.firstMatch
        app.typeKey(XCUIKeyboardKey.tab, modifierFlags: [])
        app.typeText(password)
        XCTAssertFalse((passwordField.value as? String ?? "").isEmpty, "the password never landed")
        attach(app, named: "01-credentials-entered")
        XCTAssertTrue(tap(app, label: "Login"), "no Login button")

        // A privileged role is always challenged for a second factor; password alone must not be enough.
        if !app.staticTexts["Verify it's you"].waitForExistence(timeout: 60) {
            attach(app, named: "99-no-second-factor")
            let visible = app.staticTexts.allElementsBoundByIndex.prefix(25)
                .map { $0.label }.filter { !$0.isEmpty }.joined(separator: " | ")
            XCTFail("the owner was not challenged for a second factor. On screen: \(visible)")
        }
        type(app, app.textFields.firstMatch, totp(secret: secret))
        attach(app, named: "02-second-factor")
        XCTAssertTrue(tap(app, label: "Verify and continue"), "no verify button")

        // This simulator is a new terminal, so the register asks to be registered before it will sell.
        if tap(app, label: "Register this device", timeout: 60) {
            attach(app, named: "03-device-registered")
        }

        if !tap(app, label: "Tap to unlock", timeout: 60) {
            attach(app, named: "98-no-unlock")
            let visible = app.staticTexts.allElementsBoundByIndex.prefix(30).map { $0.label }.filter { !$0.isEmpty }
            let buttons = app.buttons.allElementsBoundByIndex.prefix(30).map { $0.label }.filter { !$0.isEmpty }
            XCTFail("the register never offered to unlock. texts: \(visible.joined(separator: " | ")) :: buttons: \(buttons.joined(separator: " | "))")
        }
        for digit in pin.map(String.init) {
            XCTAssertTrue(tap(app, label: digit, timeout: 20), "keypad digit \(digit) missing")
        }
        XCTAssertTrue(tap(app, label: "Unlock register"), "no unlock button")

        XCTAssertTrue(app.staticTexts["New order"].waitForExistence(timeout: 60),
                      "the register home never opened after unlocking")
        attach(app, named: "04-register-home")
    }
}
