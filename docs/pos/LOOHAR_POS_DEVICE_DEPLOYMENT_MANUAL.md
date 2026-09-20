# Loohar POS Device Deployment Manual

How Loohar runs on dedicated point-of-sale hardware.

**Implementation status: NOT STARTED.** This manual is the architecture and the procurement
checklist. No device image, provisioning package or supported-hardware list exists yet, and no POS
hardware has been tested. Nothing here should be read as a capability Loohar has today.

Loohar does **not** build an operating system. Dedicated Android POS terminals already run Android;
the work is to manage one properly, not to replace its OS.

---

## 1. The boundary that matters

Most disappointment with "custom POS hardware" comes from assuming the software vendor can change
things only the manufacturer can. This is the split.

| Capability | Who can deliver it | Notes |
| --- | --- | --- |
| Boot logo / splash during firmware boot | **OEM only** | Burned into firmware. Must be requested at order time, usually with a minimum order quantity |
| Firmware branding, device name, model string | **OEM only** | |
| Device Owner provisioning support | **OEM** (must ship unprovisioned, Android Enterprise capable) | Without it, true kiosk mode is not possible |
| Printer hardware and its driver/SDK | **OEM** | Loohar integrates against the SDK it supplies |
| Integrated card reader and its SDK | **OEM** or Stripe | A Stripe-certified reader avoids a bespoke integration |
| Customer-facing second screen | **OEM** | Loohar can render to it via Android's presentation display API if the hardware exposes one |
| Cash drawer kick port | **OEM** | Usually driven through the printer |
| Loohar loading screen after boot | **Loohar** | This is the app's own launch screen, not the firmware logo |
| Kiosk / lock-task mode | **Loohar**, given Device Owner | |
| Provisioning, device identity, register binding | **Loohar** | |
| App updates, staged rollout, rollback | **Loohar**, through managed distribution | |
| Health reporting, offline behaviour | **Loohar** | |

## 2. Intended device lifecycle

```
Power on
 └─ OEM firmware boot (OEM logo — procurement item)
     └─ Android starts
         └─ Device Owner policy applies (Loohar is the device owner)
             └─ Loohar POS launches automatically, lock-task mode on
                 └─ Loohar loading screen
                     └─ First run: provisioning
                     │    enrolment token → device identity → restaurant,
                     │    location and register binding → printer and reader pairing
                     └─ Normal run: register ready
                          ├─ KDS over the local network / realtime
                          ├─ Card reader session
                          ├─ Offline cash when the network drops, reconciled on reconnect
                          ├─ Health heartbeat to Loohar
                          └─ Controlled update, with rollback to the previous build
```

## 3. Provisioning (Loohar software)

Android Enterprise **Device Owner** is the foundation. It can only be established on a device that
has never been set up, so devices must be enrolled before being handed to a restaurant.

1. Factory-fresh device, connected to Wi-Fi.
2. QR provisioning at the setup screen, or zero-touch enrolment if the reseller supports it.
3. The device becomes Device Owner managed; Loohar POS is installed as the kiosk app.
4. Loohar POS starts, shows its loading screen, and asks for a one-time **enrolment code** issued by
   the restaurant owner in the Loohar dashboard.
5. The device exchanges that code for its device identity, then binds to a restaurant, location and
   register. Binding is server-side, so a device cannot claim another tenant's register.
6. Printer and card reader are paired and stored against the device record.

The enrolment code must be single use, short-lived and revocable, and the device identity must be
held in the Android Keystore, exactly as the app's tokens already are.

## 4. Kiosk behaviour

With Device Owner, Loohar POS can pin itself with lock task mode, suppress the status and navigation
bars, disable safe mode, keep the screen on while charging, and survive reboot by launching on boot.
Staff leave the app only with a manager PIN, which already exists in the POS.

**Without Device Owner** (a device already set up, or an OEM that does not support it) the honest
fallback is Android's screen pinning, which a user can exit. That is a demonstration mode, not a
managed restaurant device.

## 5. Payments on the device

Two supported shapes:

1. **Stripe-certified reader over the network** — the architecture Loohar already implements and has
   tested with simulated readers. The terminal drives a reader that is itself certified; Loohar
   never handles card data.
2. **OEM integrated reader** — requires that manufacturer's payment SDK and a separate certification
   with the processor. This is a significant workstream and must not be assumed.

Card data never touches Loohar code in either case, and offline card payments are not supported.
Offline **cash** is supported, with signed pricing proofs and reconciliation on reconnect.

## 6. Updates and recovery

- Distribute through **managed Google Play** as a private app, so updates are staged and can be
  halted, or through the OEM's MDM where that is the only option.
- Keep the previous build installable for rollback, and pin a version per restaurant during a pilot.
- A device that cannot reach Loohar must still open its register and take cash; it reconciles when
  the network returns.
- Recovery from a bad update is a re-provision, which is why enrolment must be repeatable.

## 7. Health

The device should report, on a schedule: app version and commit SHA, device identity, register
binding, connectivity, printer and reader status, unreconciled offline sales, battery and storage.
That feeds the same operational alerting as the API (see `docs/operations/RUNBOOKS.md`).

## 8. What to ask a hardware manufacturer before ordering

Send this list verbatim:

1. Does the device support **Android Enterprise Device Owner** provisioning (QR or zero-touch), and
   does it ship unprovisioned?
2. Which Android version, and what is the security-update commitment?
3. Can a **custom boot logo** be flashed? What is the minimum order quantity, the file format, and
   the lead time?
4. Is there a **printer SDK** (ESC/POS or proprietary), and does it drive a cash-drawer kick port?
5. Is a **customer-facing display** available, and is it exposed as an Android presentation display?
6. Is there an **integrated card reader**? Which processors is it certified with, and is an SDK
   available?
7. Does the device support **OTA updates** under MDM control, and can updates be staged and halted?
8. What peripheral ports exist (USB, serial, Bluetooth, Ethernet)?
9. Is there a **kiosk or MDM mode** in firmware that could conflict with Device Owner?
10. Warranty, RMA process, and expected hardware lifetime.

## 9. Before any of this is real

- Choose the hardware, and confirm items 1, 3 and 4 above in writing.
- Build the Android app to an installable APK (currently blocked on the Android SDK licence).
- Implement enrolment codes, device identity and register binding on the device side.
- Test on real hardware. Nothing in this manual is certified until that happens.
