import XCTest

/// Drives the installed Loohar apps through their real interface on a simulator or device.
///
/// A launch screenshot proves only that the process started. These tests read the actual view
/// hierarchy: the sign-in screen the app routes to, the fields a person would type into, and the
/// live API indicator the app fills in from staging. They attach to an app by bundle identifier, so
/// the Capacitor projects stay untouched and can be regenerated freely.
///
/// The app under test is chosen with the LOOHAR_APP_BUNDLE_ID environment variable and defaults to
/// the POS app.
final class LooharAppLaunchTests: XCTestCase {

    private var bundleIdentifier: String {
        ProcessInfo.processInfo.environment["LOOHAR_APP_BUNDLE_ID"] ?? "com.loohar.pos"
    }

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// The web view inside a Capacitor app renders as accessibility elements, so text a person can
    /// read is queryable. Waiting on the text avoids a fixed sleep that would be flaky on a slower
    /// machine or in CI.
    private func launchApp() -> XCUIApplication {
        let app = XCUIApplication(bundleIdentifier: bundleIdentifier)
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "\(bundleIdentifier) did not come to the foreground")
        return app
    }

    private func attachScreenshot(_ app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testAppLaunchesAndShowsItsSignInScreen() throws {
        let app = launchApp()

        let signIn = app.staticTexts["Sign in"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 45), "the app did not render its sign-in screen")

        XCTAssertTrue(app.staticTexts["Email"].exists, "the email field label is missing")
        XCTAssertTrue(app.staticTexts["Password"].exists, "the password field label is missing")

        attachScreenshot(app, named: "\(bundleIdentifier)-sign-in")
    }

    /// The app fills this in from a real request to the API it was built against. If the API refused
    /// the app's origin, or the build carried a wrong URL, this reads "Unavailable" instead.
    func testAppReachesTheApiItWasBuiltAgainst() throws {
        let app = launchApp()

        let connected = app.staticTexts["Connected"]
        XCTAssertTrue(connected.waitForExistence(timeout: 60), "the app did not report a live API; it cannot reach the environment it was built for")

        attachScreenshot(app, named: "\(bundleIdentifier)-api-connected")
    }

    /// Typing into the web view proves the interface is genuinely interactive, not a static render.
    func testSignInFormAcceptsTyping() throws {
        let app = launchApp()
        XCTAssertTrue(app.staticTexts["Sign in"].waitForExistence(timeout: 45))

        let emailField = app.textFields.firstMatch
        XCTAssertTrue(emailField.waitForExistence(timeout: 15), "no text field was reachable in the sign-in form")
        emailField.tap()
        emailField.typeText("certification@example.test")

        XCTAssertTrue(app.secureTextFields.firstMatch.exists, "the password field must be a secure field")

        attachScreenshot(app, named: "\(bundleIdentifier)-typed")
    }
}
