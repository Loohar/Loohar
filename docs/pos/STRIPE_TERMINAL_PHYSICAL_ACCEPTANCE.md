# Stripe Terminal — physical acceptance steps (owner)

Loohar's card-present POS payments run on Stripe Terminal. Everything that can be rehearsed without
hardware is already built and tested with **simulated readers in Stripe test mode**. This document
covers only the steps that need a person, a physical reader, or a business decision.

Loohar never sees card numbers. The reader sends card data straight to Stripe; Loohar creates the
payment on the restaurant's own connected Stripe account and learns the result from Stripe's webhook.

## 1. Before ordering hardware

| Decision | Notes |
| --- | --- |
| Reader model | BBPOS WisePOS E (countertop, has its own screen) or Stripe Reader S700. Both are supported by the integration; the S700 is the newer model. |
| How many | One per register. The Starter plan includes one register, so a Starter pilot restaurant needs one reader. |
| Who buys | Readers are bought from Stripe's hardware store by the account that will take the payments. This is a purchase decision and a cost, so Claude will not order hardware. |
| Network | The reader needs Wi-Fi or Ethernet on the same network as the register, with outbound HTTPS to Stripe. Terminal payments require connectivity; Loohar does not accept cards offline. |

## 2. Test-mode rehearsal (no hardware needed)

This is the staging rehearsal and can be done before any reader arrives.

1. In the POS, sign in as the owner and unlock the register.
2. Register a simulated reader with the pairing code `simulated-wpe`. Loohar refuses simulated
   readers unless the Stripe credentials are test credentials, so this can never happen in production.
3. Ring up an order and take a card payment. Loohar creates the payment, hands it to the simulated
   reader, and presents a Stripe test card automatically.
4. Confirm the order shows as paid once Stripe's webhook arrives, and that the amount on the order,
   the payment and the Stripe dashboard all match.

## 3. Physical reader acceptance (owner, on site)

1. **Unbox and power the reader.** Charge it fully before the first shift.
2. **Join the network.** On the reader, open settings and connect to the restaurant's Wi-Fi. Use a
   network with internet access; guest networks that require a browser login do not work.
3. **Get the pairing code.** On the reader, open Settings and choose to connect to a POS. The reader
   shows a short pairing code (three words, for example `quick-brown-fox`).
4. **Register the reader in Loohar.** In the POS, go to register settings, choose to add a card
   reader, enter the pairing code and a label such as "Front counter", and save. Loohar registers it
   against the restaurant's own Stripe account and its Terminal location.
5. **Run a live test sale.** Take one real card payment for a small amount, such as $1.00, using a
   card you control. Confirm:
   - the reader prompts for the card and approves it,
   - the Loohar order flips to paid,
   - the amount in Loohar matches the Stripe dashboard,
   - the customer receipt prints or is emailed.
6. **Refund the test sale** from Loohar and confirm the refund appears in Stripe and on the card
   statement. This proves the whole money path in both directions.
7. **Record the result.** Note the date, reader label, last four digits of the test card and both
   payment IDs. This is the physical acceptance evidence for the launch checklist.

## 4. Things to check before the first real shift

- Every register that takes cards has its own reader, and each reader is labelled to match the till.
- Staff know that a payment can be cancelled on the reader mid-transaction, and that the order stays
  unpaid in Loohar until Stripe confirms.
- The restaurant's Stripe account is fully onboarded: charges enabled, payouts enabled, bank account
  verified.
- Someone at the restaurant knows how to remove a lost or broken reader from the POS. Removing it in
  Loohar also unregisters it at Stripe, so a stolen reader cannot take payments.

## 5. What Claude cannot do for you

- Buy hardware or enter into a contract with Stripe.
- Handle a real card, or run a live-money transaction.
- Change production Stripe settings or production environment variables.

Anything above marked as an owner step stays with you; everything else is automated and covered by
tests in `scripts/pos-terminal-db-test.mjs`.
