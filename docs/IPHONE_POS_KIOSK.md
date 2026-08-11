# iPhone POS and Kiosk Deployment

Loohar can present the restaurant POS as a standalone Home Screen web app on a supported iPhone or iPad. The web app controls the POS interface, authentication, register workflow, and operational lock screen. It cannot enforce an iOS device-level kiosk restriction.

## Demo Mode

Use a dedicated demonstration iPhone with the Loohar restaurant POS in Safari or installed through **Add to Home Screen**. Enable **iOS Guided Access** before handing the device to a prospective restaurant owner. Guided Access is an Apple device feature and must be enabled and exited by the device owner.

Recommended sequence:

1. Open the restaurant POS and sign in with the approved demonstration account.
2. Add Loohar to the Home Screen when a standalone presentation is preferred.
3. Unlock the assigned register with the demonstration employee PIN.
4. Start Guided Access for the demonstration session.
5. End Guided Access before leaving the POS or changing device settings.

## Managed Restaurant Mode

Use a restaurant-owned, supervised iPhone or iPad enrolled in the restaurant's approved Apple device-management platform. Device administrators can apply the appropriate single-app or managed-app policy, network configuration, update policy, and recovery process outside Loohar.

Loohar does not bypass iOS security, Guided Access credentials, supervision, or mobile-device-management controls. API access is still required for quoting, Kitchen submission, payment settlement, and synchronization; the service worker never caches API responses or payment data.
